const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const src = readFileSync(join(__dirname, '../js/buildings.js'), 'utf8');

// The 26 per-theme sign meshes cost 26 draw calls and 26 texture bindings. One atlas and one instanced mesh keep the
// same signs with a per-instance cell index; this pins the consolidation against a future per-theme rebuild.
test('shop signs share one atlas and one instanced mesh', () => {
  const cols = Number((src.match(/const SIGN_ATLAS_COLS = (\d+);/) || [])[1]);
  assert.equal(cols, 7, 'sign atlas keeps the 7-column layout');
  const tile = src.match(/const SIGN_TILE_W = (\d+);[\s\S]*?const SIGN_TILE_H = (\d+);[\s\S]*?const SIGN_GUTTER = (\d+);/);
  assert.ok(tile, 'sign tile dimensions found');
  assert.equal(`${tile[1]}x${tile[2]}`, '512x96', 'street-level sign text keeps its 512 x 96 px tile');
  assert.ok(Number(tile[3]) > 0, 'a gutter keeps mip bleed off the neighbouring tile');

  assert.match(src, /attribute\('signCell', 'vec2'\)/, 'a per-instance cell picks the atlas tile');
  assert.match(src, /const signInst = new THREE\.InstancedMesh\(signGeo, signMat, MAX_AWNINGS\);/, 'one sign mesh');
  assert.match(src, /signInst\.name = 'ShopSigns';/, 'the sign mesh is identifiable');
  assert.doesNotMatch(src, /signInsts/, 'no per-theme sign mesh array remains');
});

// An automatic atlas mip chain eventually averages unrelated signs. Padding alone cannot fix the final 1 x 1 mip:
// the sampler must also cap its LOD. Test the reduction and bilinear support, not only the presence of a gutter.
test('every selectable shop-sign mip keeps its filter footprint inside its own cell', () => {
  const constant = name => Number(src.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  const gutter = constant('SIGN_GUTTER');
  const maxLod = constant('SIGN_MAX_LOD');
  const cols = constant('SIGN_ATLAS_COLS');
  const rows = 4;
  assert.ok(Number.isInteger(maxLod) && maxLod >= 4, 'retain useful minification through at least level 4');
  assert.match(src, /texture\(signAtlas, signUv\)\.level\(signLod\)/, 'the atlas uses the bounded explicit LOD');
  assert.match(src, /signLod = max\(signFootprint\.x, signFootprint\.y\)\.max\(1\)\.log2\(\)\.min\(SIGN_MAX_LOD\)/);
  assert.match(src, /fwidth\(uv\(\)\.mul\(vec2\(SIGN_TILE_W, SIGN_TILE_H\)\)\)/, 'LOD uses local artwork derivatives');
  assert.match(src, /signAtlas\.anisotropy = 1;/, 'anisotropic taps cannot extend the bounded footprint');
  for (const [tile, cells] of [[constant('SIGN_TILE_W'), cols], [constant('SIGN_TILE_H'), rows]]) {
    const cell = tile + 2 * gutter;
    for (let level = 0; level <= maxLod; level++) {
      const size = 2 ** level;
      assert.equal(cell % size, 0, `cell boundaries stay aligned at mip ${level}`);
      assert.equal((cell * cells) % size, 0, `atlas dimensions stay aligned at mip ${level}`);
      for (let c = 0; c < cells; c++) {
        for (const u of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) {
          const x = (c * cell + gutter + u * tile) / size - 0.5;
          const lo = Math.floor(x);
          const hi = Math.ceil(x);
          // A mip texel k averages source interval [k * size, (k + 1) * size]. Fractional LOD is a blend of
          // adjacent levels, each proven safe here, so trilinear filtering cannot introduce a foreign colour.
          assert.ok(lo * size >= c * cell, `left tap stays in cell ${c} at mip ${level}`);
          assert.ok((hi + 1) * size <= (c + 1) * cell, `right tap stays in cell ${c} at mip ${level}`);
        }
      }
    }
  }
});
