const test = require('node:test');
const assert = require('node:assert/strict');

test('park lamps clear tree trunks, props, buildings, water, roads and rails; procedural park trees stay off walks', async () => {
  const { runParkAudit } = await import('../tools/audit-park-lamps-trees.mjs');
  const res = await runParkAudit();

  assert.equal(res.lampCounts.treeTrunkOverlap, 0, 'no park lamp overlaps a tree trunk');
  assert.equal(res.lampCounts.propOverlap, 0, 'no park lamp overlaps a bench or prop');
  assert.equal(res.lampCounts.buildingOverlap, 0, 'no park lamp overlaps a building');
  assert.equal(res.lampCounts.waterOverlap, 0, 'no park lamp stands in water or a pond');
  assert.equal(res.lampCounts.roadOverlap, 0, 'no park lamp stands in a road carriageway');
  assert.equal(res.lampCounts.railOverlap, 0, 'no park lamp stands within 2 m of rail tracks');
  assert.equal(res.lampPairs.length, 0, 'no two park/plaza lamps stand closer than 6 m');

  assert.equal(res.allProcOnWalk.length, 0, 'no procedural park tree stands on a park walk or pond path');
  assert.equal(res.treeParkAudit.fullParkBldBlocks.trunkInside, 0, 'no park tree trunk inside a building');
  assert.equal(res.treeParkAudit.fullParkBldBlocks.procCrownInWall, 0, 'no procedural park tree crown reaches a wall');
  assert.equal(res.treeParkAudit.avenida.trunkInside, 0, 'no tree trunk inside Avenida');
  assert.equal(res.treeParkAudit.avenida.crownInWall, 0, 'no tree crown reaches Avenida');
  assert.equal(res.treeParkAudit.antoninek876.trunkInside, 0, 'no tree trunk inside Antoninek block 876');
  assert.equal(res.treeParkAudit.antoninek876.crownInWall, 0, 'no tree crown reaches a wall in Antoninek block 876');
});
