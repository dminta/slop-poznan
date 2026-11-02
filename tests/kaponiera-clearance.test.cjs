const assert = require('node:assert/strict');
const test = require('node:test');

test('tram tracks crossing curb islands near Kaponiera remain at roadway height', async () => {
  const { BLOCKS, blockAt } = await import('../js/city-config.js');
  // Both points lie inside the original curb polygons, on actual tram centreline segments.
  for (const [id, x, z] of [[693, -1509.2, 81.5], [711, -1372, 100.2]]) {
    const block = BLOCKS[id];
    assert.ok(block.tramCut && block.tramCut.segs.length, `block ${id} has a rail cut`);
    assert.equal(blockAt(x, z), null, `track at ${x}, ${z} is clear of raised ground`);
  }
});
