const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The leaf atlas (js/trees.js createLeafAtlas) painted onto a recording 2D context, three.js stubbed out: every leaf,
// twig and stalk path must stay inside its own 512 px tile, or mip levels and neighbouring cards pick up stray leaves.
// The 4x2 atlas keeps the original 512 px tile size, with black locust in tile 4 and the far clump in tile 3.
const ATLAS = 2048;
const TILE = ATLAS / 4;

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
  const config = require('../js/city-config.js');
  return loadModule(readFileSync(join(__dirname, '../js/trees.js'), 'utf8'), {
    imports: { 'three/webgpu': stub, './tsl-materials.js': { createTreeMaterial: () => ({}) }, './city-config.js': config },
    globals: { document: { createElement: () => recordingCanvas(paths) }, Math, Array, Uint8Array, Uint32Array, Float32Array, Int32Array, Map, Set, Infinity },
    filename: 'trees.js'
  });
}

test('tree quality profiles map the tier block and fall back to the historical high values', () => {
  const { treeQualityProfile, TREE_QUALITY_DEFAULT } = loadTrees([]);
  const plain = (profile) => ({ ...profile, maxDist: [...profile.maxDist] });
  assert.deepEqual(plain(treeQualityProfile(null)), plain(TREE_QUALITY_DEFAULT));
  assert.deepEqual(plain(treeQualityProfile({})), plain(TREE_QUALITY_DEFAULT));
  const low = {
    lodNear: 95, lodMid: 330, maxDist: [2200, 1500, 850], streetCutoff: 900, lod1Variants: 1, farSpecies: 0
  };
  assert.deepEqual(plain(treeQualityProfile(low)), low);
  // A bad or missing field cannot shorten a tier by accident: it keeps the high value.
  const broken = treeQualityProfile({ lodNear: 0, lodMid: -5, maxDist: [0, 'x'], streetCutoff: Infinity, lod1Variants: 3, farSpecies: 9 });
  assert.deepEqual(plain(broken), plain(TREE_QUALITY_DEFAULT));
  assert.equal(treeQualityProfile({ farSpecies: null }).farSpecies, null);
});

test('Poznań tree species have distinct leaf atlas tiles', () => {
  const { TREE_SPECIES } = loadTrees([]);
  // spread: the module's arrays come from the vm context, whose Array prototype deepEqual would reject
  assert.deepEqual([...TREE_SPECIES.map((s) => s.name)], ['lime', 'maple', 'chestnut', 'robinia']);
  assert.deepEqual([...TREE_SPECIES.map((s) => s.tile)], [0, 1, 2, 4]);
  for (const s of TREE_SPECIES) assert.equal(s.tints.length, 3, s.name);
});

test('every leaf atlas path stays inside one tile', () => {
  const paths = [];
  const { createLeafAtlas } = loadTrees(paths);
  const { tileMeters } = createLeafAtlas();
  assert.equal(tileMeters.length, 5);
  for (const m of tileMeters) assert.ok(Number.isFinite(m) && m > 0.8 && m < 5, `tile ${m} m`);
  const drawn = paths.filter((p) => p.length);
  assert.ok(drawn.length > 2000, `${drawn.length} paths`);
  const perTile = [0, 0, 0, 0, 0];
  for (const p of drawn) {
    for (const [x, y] of p) assert.ok(Number.isFinite(x) && Number.isFinite(y), 'finite point');
    const tx = Math.floor(p[0][0] / TILE);
    const ty = Math.floor(p[0][1] / TILE);
    perTile[ty * 4 + tx]++;
    for (const [x, y] of p) {
      // stroke widths and the discs leaves are fitted as leave a few px of slack inside the 8 px gutter
      assert.ok(x > tx * TILE + 2 && x < (tx + 1) * TILE - 2 && y > ty * TILE + 2 && y < (ty + 1) * TILE - 2,
        `point (${x.toFixed(1)}, ${y.toFixed(1)}) leaves tile ${ty * 4 + tx}`);
    }
  }
  for (const n of perTile) assert.ok(n > 300, `paths per tile ${perTile}`);
});

test('rectangular atlas mipmaps preserve tile coverage and end at 1 by 1', () => {
  const { coverageMips } = loadTrees([]);
  const pixels = new Uint8Array(8 * 4 * 4);
  // One fully covered tile in each row, in separate pairs of columns.
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    if ((y < 2 && x < 2) || (y >= 2 && x >= 4 && x < 6)) pixels[(y * 8 + x) * 4 + 3] = 255;
  }
  const levels = coverageMips(pixels, 8, 4, 4, 2);
  assert.deepEqual(Array.from(levels, (level) => [level.width, level.height]), [[8, 4], [4, 2], [2, 1], [1, 1]]);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => levels[1].data[i * 4 + 3]), [128, 0, 0, 0, 0, 0, 128, 0]);
  assert.ok(levels[2].data[3] >= 128 && levels[2].data[7] >= 128);
});
