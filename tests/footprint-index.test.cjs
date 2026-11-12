const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { createFootprintIndex } = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
  imports: { './city-config.js': {}, './geodata.js': {} }
});

const brute = (rects, minX, maxX, minZ, maxZ, mask) => rects.some((r) =>
  r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && (r.flags & mask));

test('packed footprints preserve strict bounds, flags, negative cells and shared cell borders', () => {
  const rects = [
    { minX: -32, maxX: -16, minZ: -16, maxZ: 0, flags: 1 },
    { minX: 0, maxX: 16, minZ: 0, maxZ: 32, flags: 2 },
    { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3, flags: 3 },
    { minX: 16, maxX: 16, minZ: -32, maxZ: 32, flags: 1 },
    { minX: -100, maxX: 100, minZ: -100, maxZ: 100, flags: 0 }
  ];
  const query = createFootprintIndex(rects, (r) => r.flags);
  for (const x of [-48, -32, -16, -0.3, 0, 0.3, 16, 32, 48]) {
    for (const z of [-32, -16, -0.3, 0, 0.3, 16, 32]) {
      for (const radius of [0, 0.15, 1, 16, 65]) for (const mask of [1, 2, 3]) {
        const box = [x - radius, x + radius, z - radius, z + radius, mask];
        assert.equal(query(...box), !!brute(rects, ...box), JSON.stringify(box));
      }
    }
  }
  assert.equal(createFootprintIndex([], () => 1)(-1, 1, -1, 1, 1), false);
});

test('packed footprints retain float64 precision and own their immutable bounds and predicates', () => {
  const rect = { minX: 1000.00000001, maxX: 1000.00000002, minZ: -2, maxZ: 2, flags: 2 };
  const query = createFootprintIndex([rect], (r) => r.flags);
  assert.equal(query(1000.000000005, 1000.000000015, -1, 1, 2), true);
  assert.equal(query(1000, 1000.000000005, -1, 1, 2), false);
  rect.minX = -100;
  rect.flags = 1;
  assert.equal(query(1000, 1000.000000005, -1, 1, 2), false);
  assert.equal(query(1000.000000005, 1000.000000015, -1, 1, 2), true);
  assert.equal(query(1000.000000005, 1000.000000015, -1, 1, 1), false);
});

test('packed footprints match a direct scan for a seeded city-sized set of overlapping rectangles', () => {
  let seed = 4242;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rects = Array.from({ length: 2000 }, () => {
    const x = rand() * 16000 - 12000, z = rand() * 7000 - 3500;
    return { minX: x, maxX: x + rand() * 250, minZ: z, maxZ: z + rand() * 250, flags: (rand() * 4) | 0 };
  });
  const query = createFootprintIndex(rects, (r) => r.flags);
  for (let i = 0; i < 12000; i++) {
    const x = rand() * 16000 - 12000, z = rand() * 7000 - 3500, r = rand() * 50;
    const box = [x - r, x + r, z - r, z + r, 1 + i % 3];
    assert.equal(query(...box), !!brute(rects, ...box), `query ${i}`);
  }
});
