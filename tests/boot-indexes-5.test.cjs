const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const read = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');

function nearSegmentFactory(plain = false) {
  let source = read('pedestrian-routes.js');
  source = source.slice(source.indexOf('    const nearSegment = (ax, az, bx, bz, reach) => {'));
  source = source.slice(0, source.indexOf('\n    };') + 7);
  if (plain) source = source.replace(/      \/\/ Signal placement[^]*?      const dx =/, '      const dx =');
  return vm.runInNewContext(`(x, z) => { ${source}; return nearSegment; }`, { Math });
}

test('nearby route segment reject preserves the plain projection at boundaries and on real roads', async () => {
  const { GEO } = await import('../js/geodata.js');
  const indexed = nearSegmentFactory(), plain = nearSegmentFactory(true);
  let seed = 17;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let count = 0;
  const segments = [[0, 0, 0, 0], [32, -64, 32, 64], [-1000, 0, 1000, 0]];
  for (const road of GEO.roads) {
    const pts = road[5];
    for (let i = 0; i + 3 < pts.length; i += 2) segments.push(pts.slice(i, i + 4));
  }
  for (const s of segments) {
    const [ax, az, bx, bz] = s;
    const reach = 1 + random() * 100;
    for (const [x, z] of [[ax, az], [bx, bz], [ax + reach, az], [bx - reach, bz],
      [ax + reach + 1e-9, az], [ax + reach - 1e-9, az],
      [ax + (random() - 0.5) * 500, az + (random() - 0.5) * 500]]) {
      assert.equal(indexed(x, z)(...s, reach), plain(x, z)(...s, reach));
      count++;
    }
  }
  assert.ok(count > 100000);
});

test('distant route candidates skip projection and hypot', () => {
  let calls = 0;
  const math = Object.create(Math);
  math.hypot = (...args) => { calls++; return Math.hypot(...args); };
  let source = read('pedestrian-routes.js');
  source = source.slice(source.indexOf('    const nearSegment = (ax, az, bx, bz, reach) => {'));
  source = source.slice(0, source.indexOf('\n    };') + 7);
  const query = vm.runInNewContext(`(x, z) => { ${source}; return nearSegment; }`, { Math: math })(0, 0);
  assert.equal(query(1000, 1000, 2000, 2000, 50), false);
  assert.equal(calls, 0);
  assert.equal(query(-50, 0, 50, 0, 1), true);
  assert.equal(calls, 1);
});

test('partial-park rings reuse one lazy lot layout per block and release it between blocks', () => {
  let source = read('city-grid.js');
  source = source.slice(source.indexOf('  const PARK_TREE_EDGE = 10;'), source.indexOf('  // One merged lawn mesh'));
  const ring = [1, 1, 19, 1, 19, 19, 1, 19];
  function run(plain) {
    let calls = 0;
    const blocks = [0, 1].map((id) => ({ id, park: 0.5, buildings: 1, minX: 0, maxX: 20, minZ: 0, maxZ: 20 }));
    const visited = [];
    const context = {
      GEO: { parks: [{ rings: [ring, ring, ring] }] }, BLOCKS: blocks,
      isParkBlock: () => false, pointInBlockPoly: () => false, prand: () => 0.5,
      blockLots: (b) => { calls++; visited.push(b.id); return []; }
    };
    vm.runInNewContext(plain ? source.replace('if (!bLots) bLots =', 'bLots =') : source, context);
    return { calls, visited };
  }
  assert.deepEqual(run(false), { calls: 2, visited: [0, 1] });
  assert.deepEqual(run(true), { calls: 6, visited: [0, 0, 0, 1, 1, 1] });
});

test('numeric signal-placement buckets preserve the string grid candidates and order', () => {
  let source = read('street-details.js');
  source = source.slice(source.indexOf('  function auditRuntimeSignalHeads('));
  source = source.slice(source.indexOf('    const key ='), source.indexOf('    const curves ='));
  const plain = source.replace('Math.floor(x / cell) * 100000 + Math.floor(z / cell)',
    '`${Math.floor(x / cell)},${Math.floor(z / cell)}`').replace('ix * 100000 + iz', '`${ix},${iz}`');
  const load = (text) => vm.runInNewContext(`${text}\n({ file, lookup })`, { cell: 16, Math });
  const a = load(source), b = load(plain), numeric = new Map(), strings = new Map();
  let seed = 4242;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const queries = [];
  for (let i = 0; i < 1000; i++) {
    const x = Math.floor((-9500 + random() * 14000) / 16) * 16;
    const z = Math.floor((-2500 + random() * 6500) / 16) * 16;
    const item = { id: i }, w = random() * 300, d = random() * 300;
    a.file(numeric, item, x, x + w, z, z + d);
    b.file(strings, item, x, x + w, z, z + d);
    for (const delta of [0, -1e-9, 1e-9, 16, 32]) queries.push([x + delta, z + delta]);
    queries.push([x + w, z + d]);
  }
  for (const [x, z] of queries) {
    assert.deepEqual(Array.from(a.lookup(numeric, x, z)), Array.from(b.lookup(strings, x, z)));
  }
  assert.equal(numeric.size, strings.size);
});
