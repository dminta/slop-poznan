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

test('the Milczańska park strip remains clear of the carriageway', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'for (const piece of pieces) parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);';
  assert.ok(source.includes(marker));
  let strip;
  const grid = loadModule(source.replace(marker, 'recordPieces(b, lawn, pieces);\n          ' + marker), {
    imports: { 'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, recordPieces: (block, lawn, pieces) => {
      if (block.minX === 1350 && lawn.length === 72) strip = { block, lawn, pieces };
    } }
  });
  grid.buildCityGrid(inert());
  assert.ok(strip, 'the real mapped strip is emitted');
  const { block, lawn, pieces } = strip;
  const area = (p) => Math.abs(p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a.x * b.z - b.x * a.z;
  }, 0)) / 2;
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const ring of [lawn, block.poly]) {
    for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], d = ring[(j + 1) % ring.length];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0),
        'both clipping inputs are simple');
    }
  }
  const remaining = pieces.reduce((sum, p) => sum + area(p), 0);
  assert.ok(remaining > area(lawn) * 0.5 && remaining <= area(lawn) + 0.01, 'clipping retains the strip without overlap');
  const onBoundary = (x, z) => block.poly.some((a, i) => {
    const b = block.poly[(i + 1) % block.poly.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < 1e-5;
  });
  for (const piece of pieces) for (let i = 0; i < piece.length; i++) {
    const a = piece[i], b = piece[(i + 1) % piece.length];
    for (const [x, z] of [[a.x, a.z], [(a.x + b.x) / 2, (a.z + b.z) / 2]]) {
      assert.ok(inside(block.poly, x, z) || onBoundary(x, z), 'the clipped lawn stays within its block');
    }
  }
  let samples = 0;
  for (const road of GEO.roads.filter((r) => r[0] === 'Milczańska')) {
    const p = road[5];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
      if (!len) continue;
      for (let s = 0; s <= len; s += 0.5) for (const side of [-0.45, 0, 0.45]) {
        const x = p[i] + dx * s / len - dz / len * road[1] * side;
        const z = p[i + 1] + dz * s / len + dx / len * road[1] * side;
        if (x < 2100 || x > 2370 || z < 1600 || z > 1950) continue;
        samples++;
        assert.ok(!pieces.some((ring) => inside(ring, x, z)), `lawn covers Milczańska at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
  }
  assert.ok(samples > 100, 'the roadway was sampled throughout the affected strip');
});
