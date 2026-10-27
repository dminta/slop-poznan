const assert = require('node:assert/strict');
const test = require('node:test');

// Śródka's mural square (city-config.js SRODKA_MURAL, built by landmarks-heritage.js): the house and the square in
// front of its painted wall must stand on the Śródka curb island, clear of the roadways, with the wall facing east
// over the square
let SRODKA_MURAL, blockAt, roadClearance, LL;
test.before(async () => {
  ({ SRODKA_MURAL, blockAt, roadClearance, LL } = await import('../js/city-config.js'));
});

test('the mural wall is ul. Śródka 3\'s east wall, facing the square', () => {
  const M = SRODKA_MURAL;
  assert.ok(Math.abs(M.len - 20.25) < 0.1, `wall ${M.len} m`);
  const out = M.toWorld(0, 1);
  const dx = out.x - M.cx;
  const dz = out.z - M.cz;
  assert.ok(Math.abs(Math.hypot(dx, dz) - 1) < 1e-9);
  assert.ok(dx > 0.9, 'faces east (east-south-east)');
  // the wall's ends map back onto its OSM corners
  const a = M.toWorld(-M.len / 2, 0);
  const b = M.toWorld(M.len / 2, 0);
  assert.ok(Math.hypot(a.x - M.a.x, a.z - M.a.z) < 1e-6 && Math.hypot(b.x - M.b.x, b.z - M.b.z) < 1e-6);
  // ul. Śródka 3 (52.4113 N, 16.9535 E) lies within 30 m of the wall's middle
  const p = LL(16.9534, 52.41128);
  assert.ok(Math.hypot(p.x - M.cx, p.z - M.cz) < 30);
});

test('the house and the square stand on one curb island, off the roadways', () => {
  const M = SRODKA_MURAL;
  const island = blockAt(M.cx - 2, M.cz);
  assert.ok(island, 'on a curb island');
  for (let lx = -M.len / 2 + 0.5; lx <= M.len / 2 - 0.5; lx += 2) {
    for (let lz = -M.depth + 0.5; lz <= M.square - 1; lz += 2) {
      const p = M.toWorld(lx, lz);
      // the square's far corners are cut by the curb; the paving stops 1 m short of it (landmarks-heritage.js)
      if (lz > M.square - 3 && Math.abs(lx) > M.len / 2 - 3) continue;
      assert.equal(blockAt(p.x, p.z), island, `local (${lx.toFixed(1)}, ${lz.toFixed(1)}) on the island`);
      assert.ok(!(roadClearance(p.x, p.z) < 0), `local (${lx.toFixed(1)}, ${lz.toFixed(1)}) off the roadway`);
    }
  }
});
