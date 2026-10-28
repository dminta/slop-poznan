const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The leaf atlas (js/trees.js createLeafAtlas) painted onto a recording 2D context, three.js stubbed out: every leaf,
// twig and stalk path must stay inside its own 512 px tile, or mip levels and neighbouring cards pick up stray leaves.
// Measured 2026-10 (lime, Norway maple, horse chestnut, far clump): tiles 1.07 / 1.35 / 1.11 / 2.48 m wide (the former
// London plane, honey locust, American elm and clump tiles were 1.23 / 1.09 / 1.05 / 2.30 m).
const ATLAS = 1024;
const TILE = ATLAS / 2;

function recordingCanvas(paths) {
  let current = null;
  const add = (x, y) => current && current.push([x, y]);
  const ctx = {
    beginPath() {
      current = [];
      paths.push(current);
    },
    moveTo: add,
    lineTo: add,
    bezierCurveTo(...a) {
      for (let i = 0; i < 6; i += 2) add(a[i], a[i + 1]);
    },
    arc(x, y, r) {
      add(x - r, y - r);
      add(x + r, y + r);
    },
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  };
  return { width: 0, height: 0, getContext: () => ctx };
}

function loadTrees(paths) {
  const stub = new Proxy({}, { get: () => function Stub() { return {}; } });
  return loadModule(readFileSync(join(__dirname, '../js/trees.js'), 'utf8'), {
    imports: { 'three/webgpu': stub, './tsl-materials.js': { createTreeMaterial: () => ({}) } },
    globals: { document: { createElement: () => recordingCanvas(paths) }, Math, Array, Uint8Array, Uint32Array, Float32Array, Int32Array, Map, Set, Infinity },
    filename: 'trees.js'
  });
}

test('Poznań tree species share the leaf atlas tiles 0-2', () => {
  const { TREE_SPECIES } = loadTrees([]);
  // spread: the module's arrays come from the vm context, whose Array prototype deepEqual would reject
  assert.deepEqual([...TREE_SPECIES.map((s) => s.name)], ['lime', 'maple', 'chestnut']);
  assert.deepEqual([...TREE_SPECIES.map((s) => s.tile)], [0, 1, 2]);
  for (const s of TREE_SPECIES) assert.equal(s.tints.length, 3, s.name);
});

test('every leaf atlas path stays inside one tile', () => {
  const paths = [];
  const { createLeafAtlas } = loadTrees(paths);
  const { tileMeters } = createLeafAtlas();
  assert.equal(tileMeters.length, 4);
  for (const m of tileMeters) assert.ok(Number.isFinite(m) && m > 0.8 && m < 5, `tile ${m} m`);
  const drawn = paths.filter((p) => p.length);
  assert.ok(drawn.length > 2000, `${drawn.length} paths`);
  const perTile = [0, 0, 0, 0];
  for (const p of drawn) {
    for (const [x, y] of p) assert.ok(Number.isFinite(x) && Number.isFinite(y), 'finite point');
    const tx = Math.floor(p[0][0] / TILE);
    const ty = Math.floor(p[0][1] / TILE);
    perTile[ty * 2 + tx]++;
    for (const [x, y] of p) {
      // stroke widths and the discs leaves are fitted as leave a few px of slack inside the 8 px gutter
      assert.ok(x > tx * TILE + 2 && x < (tx + 1) * TILE - 2 && y > ty * TILE + 2 && y < (ty + 1) * TILE - 2,
        `point (${x.toFixed(1)}, ${y.toFixed(1)}) leaves tile ${ty * 2 + tx}`);
    }
  }
  for (const n of perTile) assert.ok(n > 300, `paths per tile ${perTile}`);
});
