const assert = require('node:assert/strict');
const test = require('node:test');

// The bespoke OSM tree snapshot (tools/data/poz_trees.json → GEO.trees) is the only real tree-position source. These
// checks pin the in-box count, the compact layout and the duplicate filter, so a broken Overpass refresh or a frame
// projection change cannot silently move or multiply the mapped trees.
test('GEO.trees keeps the surveyed natural=tree positions in the detail box', async () => {
  const { GEO } = await import('../js/geodata.js');
  const { OSM_TREES } = await import('../js/city-config.js');
  assert.equal(GEO.trees.length % 4, 0);
  assert.equal(GEO.trees.length, 38757 * 4);
  assert.equal(OSM_TREES.length, 38757);
  const [x0, x1, z0, z1] = GEO.frame.detailBox;
  const species = [0, 0, 0, 0, 0];
  const cells = new Map();
  let minPair = Infinity;
  for (let i = 0; i < OSM_TREES.length; i++) {
    const t = OSM_TREES[i];
    const flat = GEO.trees.subarray ? GEO.trees.subarray(i * 4, i * 4 + 4) : GEO.trees.slice(i * 4, i * 4 + 4);
    assert.deepEqual([...flat], [t.x, t.z, t.species, t.height]);
    assert.ok(t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1, `tree ${i} inside the detail box`);
    assert.ok(t.species >= -1 && t.species <= 3, `species ${t.species}`);
    assert.ok(Number.isFinite(t.height) && t.height >= 0 && t.height < 80, `height ${t.height}`);
    species[t.species + 1]++;
    const key = Math.floor(t.x) * 100000 + Math.floor(t.z);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  for (const t of OSM_TREES) {
    for (let ix = Math.floor(t.x) - 1; ix <= Math.floor(t.x) + 1; ix++) {
      for (let iz = Math.floor(t.z) - 1; iz <= Math.floor(t.z) + 1; iz++) {
        for (const other of cells.get(ix * 100000 + iz) || []) {
          if (other !== t) minPair = Math.min(minPair, Math.hypot(t.x - other.x, t.z - other.z));
        }
      }
    }
  }
  assert.ok(minPair >= 0.5, `duplicate positions removed (${minPair.toFixed(3)} m)`);
  // Mapped model species only; 24,756 other/untagged trees stay -1 and get a deterministic model at runtime.
  assert.deepEqual(species, [24756, 3805, 7078, 984, 2134]);
});
