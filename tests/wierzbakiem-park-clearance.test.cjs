const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}

function inside(poly, x, z) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

test('the park bed and lawn beside Nad Wierzbakiem remain simple and clear of the carriageway', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'const lawnTop = offsetPolygonInward(bed, 0.3);';
  assert.ok(source.includes(marker));
  let shapes;
  const grid = loadModule(source.replace(marker, marker + '\n    if (b.id === 314) recordPark(b, bed, lawnTop);'), {
    imports: { 'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, recordPark: (block, bed, lawn) => { shapes = { block, bed, lawn }; } }
  });
  grid.buildCityGrid(inert());
  assert.ok(shapes && shapes.bed && shapes.lawn);
  const { block, bed, lawn } = shapes;
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const ring of [bed, lawn]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        const c = ring[j], d = ring[(j + 1) % ring.length];
        assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0), 'ring does not cross itself');
      }
      for (let t = 0; t < 1; t += 0.05) {
        assert.ok(inside(block.poly, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), 'edge stays within the island');
      }
    }
    for (const r of GEO.roads.filter((road) => road[0] === 'Nad Wierzbakiem')) {
      const p = r[5];
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
        if (!len) continue;
        for (let t = 0; t <= 1; t += 1 / Math.ceil(len)) {
          for (const offset of [-0.4, 0, 0.4]) {
            const x = p[i] + dx * t - dz / len * r[1] * offset;
            const z = p[i + 1] + dz * t + dx / len * r[1] * offset;
            assert.ok(!inside(ring, x, z), `carriageway covered at ${x.toFixed(2)}, ${z.toFixed(2)}`);
          }
        }
      }
    }
  }
});
