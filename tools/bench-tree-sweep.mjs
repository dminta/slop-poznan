// Times the incremental tree level sweep (js/trees.js createLevelSweep) against the original full sweep over the
// recorded-style camera paths, checking after every update that lod[] and the change list are identical.
//   node tools/bench-tree-sweep.mjs [trees.json]
// trees.json = { px, py, pz, tier } of the live field (dumped from the browser); without it a synthetic 118 k field is used.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { lowTreeSettings, loadTrees, loadSweepNative, fullSweep, syntheticField, cameraPaths } = require('../tests/helpers/tree-sweep.cjs');
const { TREE_QUALITY_DEFAULT, treeQualityProfile } = loadTrees();
const { createLevelSweep } = loadSweepNative(); // same source, this realm (the vm copy is slower)
const LOW = treeQualityProfile(lowTreeSettings());

let field;
if (process.argv[2]) {
  const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  field = { px: Float32Array.from(j.px), py: Float32Array.from(j.py), pz: Float32Array.from(j.pz), tier: Uint8Array.from(j.tier) };
} else field = syntheticField(118067);
const { px, py, pz, tier } = field;
const cells = new Map();
for (let i = 0; i < px.length; i++) {
  const key = Math.floor(px[i] / 200) + ',' + Math.floor(pz[i] / 200);
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(i);
}
const groups = [...cells.values()];
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return `${q(s, 0.5).toFixed(3)} / ${q(s, 0.95).toFixed(3)} / ${s[s.length - 1].toFixed(3)}`; };

console.log(`trees ${px.length}, 200 m cells ${groups.length}`);
console.log('| profile | path | updates (changed) | full ms med/p95/max | incremental ms med/p95/max | trees visited mean / max | equal |');
console.log('|---|---|---|---|---|---|---|');
for (const [pn, profile] of [['high', TREE_QUALITY_DEFAULT], ['low', LOW]]) {
  for (const [name, path] of Object.entries(cameraPaths())) {
    let result;
    for (let rep = 0; rep < 3; rep++) { // keep the last (warm) repetition
      const lodF = new Uint8Array(px.length).fill(255);
      const lodI = new Uint8Array(px.length).fill(255);
      let nI = 0;
      let nF = 0;
      let sumI = 0;
      let sumF = 0;
      const sweep = createLevelSweep(profile, px, py, pz, tier, lodI, groups, (i, p, n) => { nI = (nI * 31 + i * 7 + p + n * 3) | 0; });
      const tF = [];
      const tI = [];
      const vis = [];
      let last = [Infinity, Infinity, Infinity];
      let equal = true;
      let updates = 0;
      let changedUpdates = 0;
      for (const [x, y, z] of path) {
        if ((x - last[0]) ** 2 + (y - last[1]) ** 2 + (z - last[2]) ** 2 < 16) continue;
        last = [x, y, z];
        nF = 0; nI = 0;
        let a = performance.now();
        const cF = fullSweep(profile, px, py, pz, tier, lodF, x, y, z, (i, p, n) => { nF = (nF * 31 + i * 7 + p + n * 3) | 0; });
        let b = performance.now();
        tF.push(b - a);
        a = performance.now();
        const cI = sweep.run(x, y, z);
        b = performance.now();
        tI.push(b - a);
        vis.push(sweep.visited);
        // the first update (everything hidden -> visible) is the full cost for both; skipped from the time statistics
        if (cF !== cI || nF !== nI) equal = false;
        if (updates === 0) { tF.pop(); tI.pop(); vis.pop(); }
        updates++;
        if (cF) changedUpdates++;
      }
      equal = equal && Buffer.from(lodI).equals(Buffer.from(lodF));
      result = { updates, changedUpdates, tF, tI, vis, equal };
    }
    const r = result;
    console.log(`| ${pn} | ${name} | ${r.updates} (${r.changedUpdates}) | ${stat(r.tF)} | ${stat(r.tI)} | ${(r.vis.reduce((s, v) => s + v, 0) / r.vis.length).toFixed(0)} / ${Math.max(...r.vis)} | ${r.equal} |`);
  }
}
