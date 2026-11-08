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
