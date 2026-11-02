const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
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

test('the Pułaskiego / Cicha park surfaces leave both roads clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  assert.ok(source.includes(marker));
  const recorded = [];
  let current;
  const modified = source.replaceAll('for (const b of BLOCKS) {', 'for (const b of BLOCKS) { selectBlock(b);')
    .replace(marker, 'recordPolygon(pts, bottomY, height, holes);\n  ' + marker);
  const stub = inert();
  loadModule(modified, {
    imports: { 'three/webgpu': stub, 'three/tsl': stub, 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, selectBlock: (b) => { current = b; },
      recordPolygon: (pts, bottom, height, holes) => {
        if (current && current.minX === -892 && current.maxX === -503 && bottom <= 0.3) {
          recorded.push({ pts, bottom, holes });
        }
      } }
  }).buildCityGrid(stub);
  assert.ok(recorded.length > 2, 'the real curb, paving, coping and lawn are observed');
  const block = config.BLOCKS.find((b) => b.minX === -892 && b.maxX === -503 && b.minZ === -1206);
  assert.ok(block.roadCut && block.roadCut.length, 'the actual road corridors are attached to the park');
  const offset = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const point = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const f = vm.runInNewContext(`${offset}\n${point}\n${area}\n${clipping}\n({ offsetPolygonInward, parkBedOutline, triangulateRing, polygonCentroidArea })`);
  const bed = f.offsetPolygonInward(f.parkBedOutline(block), 1);
  const lawn = f.offsetPolygonInward(bed, 0.3);
  for (const ring of [block.poly, f.offsetPolygonInward(block.poly, 0.1), bed, lawn]) {
    assert.ok(ring && ring.length >= 3);
    const triangles = f.triangulateRing(ring);
    const sum = triangles.reduce((n, t) => n + f.polygonCentroidArea(t), 0);
    assert.ok(Math.abs(sum - Math.abs(f.polygonCentroidArea(ring))) < 0.001, 'input ring triangulates without overlap');
  }
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const ring of [bed, lawn]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      for (let t = 0; t < 1; t += 0.05) {
        assert.ok(inside(block.poly, a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t), 'bed stays inside the park');
      }
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        const p = ring[j], q = ring[(j + 1) % ring.length];
        assert.ok(!(cross(a, c, p) * cross(a, c, q) < 0 && cross(p, q, a) * cross(p, q, c) < 0), 'bed does not fold');
      }
    }
  }
  assert.ok(Math.abs(f.polygonCentroidArea(lawn)) > block.area * 0.85, 'the park keeps most of its lawn');
  for (const [ax, az, bx, bz, half] of block.roadCut) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    for (let s = 0; s <= len; s += 0.5) {
      for (const side of [-0.8 * half, 0, 0.8 * half]) {
        const x = ax + dx * s / len - dz * side / len, z = az + dz * s / len + dx * side / len;
        assert.ok(!recorded.some(({ pts, holes }) => inside(pts, x, z) && !holes.some((h) => inside(h, x, z))),
          `park surface covers a road corridor at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      }
    }
  }
  for (const [x, z] of [[-889.18, -1006.82], [-887.16, -1006.5]]) {
    assert.ok(!recorded.some(({ pts, holes }) => inside(pts, x, z) && !holes.some((h) => inside(h, x, z))),
      `a raised park surface covers the roadway at ${x}, ${z}`);
    assert.equal(config.blockAt(x, z), null, 'the roadway is not treated as raised ground');
  }
});
