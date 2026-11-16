const assert = require('node:assert/strict');
const test = require('node:test');
const { lowTreeSettings, loadTrees, fullSweep, syntheticField, cameraPaths } = require('./helpers/tree-sweep.cjs');
const { TREE_QUALITY_DEFAULT, createLevelSweep, treeQualityProfile } = loadTrees();

// js/trees.js createLevelSweep must leave lod[] and the change list (ids, order, transitions) exactly as the original
// full sweep over all trees, after every update, for any camera path. The reference loop is a verbatim copy.
const LOW_TIER = treeQualityProfile(lowTreeSettings());

function cellGroups(px, pz) {
  const cells = new Map();
  for (let i = 0; i < px.length; i++) {
    const key = Math.floor(px[i] / 200) + ',' + Math.floor(pz[i] / 200);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  return [...cells.values()];
}

function compare(profile, field, path, name) {
  const { px, py, pz, tier } = field;
  const n = px.length;
  const lodFull = new Uint8Array(n).fill(255);
  const lodInc = new Uint8Array(n).fill(255);
  let logFull = [];
  let logInc = [];
  const sweep = createLevelSweep(profile, px, py, pz, tier, lodInc, cellGroups(px, pz), (i, p, q) => logInc.push(i, p, q));
  let updates = 0;
  let visited = 0;
  let last = [Infinity, Infinity, Infinity];
  for (const [x, y, z] of path) {
    if ((x - last[0]) ** 2 + (y - last[1]) ** 2 + (z - last[2]) ** 2 < 16) continue; // the 4 m early-out of update()
    last = [x, y, z];
    logFull = [];
    logInc = [];
    fullSweep(profile, px, py, pz, tier, lodFull, x, y, z, (i, p, q) => logFull.push(i, p, q));
    const changed = sweep.run(x, y, z);
    assert.equal(changed * 3, logInc.length, `${name} update ${updates}`);
    assert.deepEqual(logInc, logFull, `${name} update ${updates}: change list`);
    assert.ok(Buffer.from(lodInc).equals(Buffer.from(lodFull)), `${name} update ${updates}: lod[]`);
    updates++;
    visited += sweep.visited;
  }
  return { updates, visited: visited / updates, n };
}

test('incremental level sweep equals the full sweep on every recorded-style path and both tier profiles', () => {
  const field = syntheticField(15000);
  const paths = cameraPaths();
  for (const [profileName, profile] of [['high', TREE_QUALITY_DEFAULT], ['low', LOW_TIER]]) {
    for (const [pathName, path] of Object.entries(paths)) {
      const r = compare(profile, field, path, `${profileName}/${pathName}`);
      assert.ok(r.updates > 20, `${profileName}/${pathName} ran ${r.updates} updates`);
      // Later updates must skip most trees (the first ones from the all-hidden start visit everything)
      if (pathName === 'driving' || pathName === 'orbit') assert.ok(r.visited < r.n * 0.5, `${profileName}/${pathName} visited ${r.visited}`);
    }
  }
});

test('incremental level sweep stays exact when the camera jumps and when trees sit on the boundaries', () => {
  // Trees on exact boundary distances from a fixed spot, plus jumps between far-apart cameras
  const n = 6000;
  const px = new Float32Array(n);
  const py = new Float32Array(n).fill(6);
  const pz = new Float32Array(n);
  const tier = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = [105, 420, 950, 1150, 1600, 3000][i % 6] + ((i % 13) - 6) * 0.5;
    const a = (i / n) * 90 * Math.PI;
    px[i] = Math.cos(a) * r;
    pz[i] = Math.sin(a) * r;
    tier[i] = i % 3;
  }
  const jumps = [[0, 6, 0], [0, 80, 0], [0, 39.99, 0], [2000, 40, 0], [-4000, 10, 3000], [0, 6, 0], [3, 41, 3], [0, 6, 0]];
  compare(TREE_QUALITY_DEFAULT, { px, py, pz, tier }, jumps, 'ring/high');
  compare(LOW_TIER, { px, py, pz, tier }, jumps, 'ring/low');
});
