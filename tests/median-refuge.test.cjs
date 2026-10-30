const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
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
    apply: () => inert(),
    construct: () => inert()
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

test('the Dworzec refuge walk and waiting space stay outside the rendered hedge', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const hedges = [];
  // Observe the polygons actually sent to extrusion, rather than duplicating the hedge layout in the test.
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8').replace(
    'const shape = createWorldXZShape(pts, holes);',
    'recordPolygon(pts, bottomY, height);\n  const shape = createWorldXZShape(pts, holes);'
  );
  const grid = loadModule(source, {
    imports: {
      'three/webgpu': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config,
      './geodata.js': { GEO },
      './tsl-materials.js': inert()
    },
    globals: {
      console: { info() {}, warn() {}, log() {} },
      recordPolygon: (pts, y, h) => { if (y === 0.22 && h === 0.55) hedges.push(pts); }
    }
  }).buildCityGrid(inert());
  assert.ok(hedges.length > 0, 'the real grid still extrudes planted medians');
  const covered = (x, z) => hedges.some((poly) => inside(poly, x, z));
  const ax = -1582.819, az = 563.234, bx = -1580.760, bz = 558.363;
  const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
  for (let s = 0; s <= len; s += 0.2) {
    for (const side of [-1.2, 0, 1.2]) {
      const x = ax + ux * s - uz * side, z = az + uz * s + ux * side;
      assert.ok(!covered(x, z), `the refuge corridor is visibly clear at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
  assert.ok(!covered(bx + ux, bz + uz), 'space beyond the shared-crossing landing is clear');
  assert.ok(covered(-1582, 550), 'planting at the northern end of the refuge remains');
  assert.ok(grid.footprints.some((r) => r.walkable && r.minX <= bx && r.maxX >= bx && r.minZ <= bz && r.maxZ >= bz),
    'the median remains a walkable traffic obstacle');
});
