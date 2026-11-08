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

test('partial park lawns leave Skromna and Zmartwychwstańców clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  const piecesMarker = 'for (const piece of pieces) parkLawnGeos.push(createExtrudedPolygonMesh(piece, SW_TOP - 0.02, 0.06, lawnMat).geometry);';
  assert.ok(source.includes(marker));
  assert.ok(source.includes(piecesMarker));
  const lawns = [];
  const clipped = new Map();
  const grid = loadModule(source.replace(marker, 'recordPolygon(pts, bottomY, height);\n  ' + marker)
    .replace(piecesMarker, 'recordPieces(b, lawn, pieces);\n          ' + piecesMarker), {
    imports: { 'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, recordPieces: (block, lawn, pieces) => {
      if (block.id === 200 && inside(lawn, 2705.93, -1895.8) || block.id === 1270 && inside(lawn, -856.19, 2443)) {
        clipped.set(block.id, { lawn, pieces });
      }
    }, recordPolygon: (pts, bottom, height) => {
      if (Math.abs(bottom - 0.2) < 1e-9 && Math.abs(height - 0.06) < 1e-9) lawns.push(pts);
    } }
  });
  grid.buildCityGrid(inert());
  assert.ok(lawns.length > 100, 'the real partially parked block surfaces were built');
  assert.equal(clipped.size, 2, 'both affected original lawns were found');
  const area = (ring) => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0)) / 2;
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const { lawn, pieces } of clipped.values()) {
    for (let i = 0; i < lawn.length; i++) for (let j = i + 2; j < lawn.length; j++) {
      if (i === 0 && j === lawn.length - 1) continue;
      const a = lawn[i], b = lawn[(i + 1) % lawn.length], c = lawn[j], d = lawn[(j + 1) % lawn.length];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0), 'original lawn is simple');
    }
    const remaining = pieces.reduce((sum, piece) => sum + area(piece), 0);
    assert.ok(remaining > area(lawn) * 0.9 && remaining <= area(lawn) + 0.01, 'the cut preserves most of the lawn without overlap');
  }
  for (const [name, region] of [['Skromna', [2690, 2720, -1910, -1880]],
    ['Zmartwychwstańców', [-875, -845, 2435, 2475]]]) {
    let samples = 0;
    for (const r of GEO.roads.filter((road) => road[0] === name)) {
      const p = r[5];
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
        if (!len) continue;
        for (let s = 0; s <= len; s += 0.5) for (const side of [-0.45, 0, 0.45]) {
          const x = p[i] + dx * s / len - dz / len * r[1] * side;
          const z = p[i + 1] + dz * s / len + dx / len * r[1] * side;
          if (x < region[0] || x > region[1] || z < region[2] || z > region[3]) continue;
          samples++;
          assert.ok(!lawns.some((ring) => inside(ring, x, z)), `${name} lawn covers ${x.toFixed(1)}, ${z.toFixed(1)}`);
        }
      }
    }
    assert.ok(samples > 30, `sampled ${name}`);
  }
});
