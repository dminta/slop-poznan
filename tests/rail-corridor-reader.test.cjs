const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// Exercise the production factory without running the full railway placement. Its only input is the live raster;
// layout construction queries must not be needed by a retained player-collision callback.
const source = readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8');
const start = source.indexOf('function createRailCorridorTest(');
const end = source.indexOf('\n// --- Track geometry', start);
assert.ok(start >= 0 && end > start);
const createReader = vm.runInNewContext(`${source.slice(start, end)}\ncreateRailCorridorTest;`, { Math });

function cell(tiles, x, z, value) {
  const tx = Math.floor(x / 64), tz = Math.floor(z / 64);
  const key = (tx + 512) * 1024 + tz + 512;
  let tile = tiles.get(key);
  if (!tile) tiles.set(key, (tile = new Uint8Array(4096)));
  tile[(x - tx * 64) + (z - tz * 64) * 64] = value;
}

test('rail corridor reader preserves negative, fractional and tile-boundary coordinates', () => {
  const tiles = new Map();
  const points = [[-65, -65], [-64, 63], [-1, -1], [0, 0], [63, 64], [64, -64], [127, 127]];
  for (const [x, z] of points) cell(tiles, x, z, 1);
  const has = createReader(tiles);
  for (const [x, z] of points) {
    assert.equal(has(x, z), true);
    assert.equal(has(x + 0.99999, z + 0.99999), true);
    assert.equal(has(x - 0.00001, z), false);
    assert.equal(has(x, z - 0.00001), false);
  }
  assert.equal(has(1000, -1000), false);
});

test('rail corridor reader sees final crossing clears and later raster edits', () => {
  const tiles = new Map();
  cell(tiles, -1, 64, 1);
  const has = createReader(tiles);
  assert.equal(has(-0.5, 64.5), true);
  cell(tiles, -1, 64, 0);
  assert.equal(has(-0.5, 64.5), false);
  cell(tiles, 64, -1, 1);
  assert.equal(has(64.5, -0.5), true);
});
