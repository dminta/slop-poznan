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

test('park island between Armii Poznań and Pułaskiego leaves the roadway clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const block = config.BLOCKS.find((b) => b.minX === -1003.5 && b.maxX === -727.5 && b.minZ === -2060 && b.maxZ === -1224);
  assert.ok(block);
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  const modified = source.replaceAll('for (const b of BLOCKS) {', 'for (const b of BLOCKS) { selectBlock(b);')
    .replace(marker, 'recordPolygon(pts, bottomY, height, holes);\n  ' + marker);
  const recorded = [];
  let current;
  const stub = inert();
  loadModule(modified, {
    imports: { 'three/webgpu': stub, 'three/tsl': stub, 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, selectBlock: (b) => { current = b; },
      recordPolygon: (pts, bottom, height, holes) => {
        if (current === block && bottom <= 0.3) recorded.push({ pts, bottom, holes });
      } }
  }).buildCityGrid(stub);
  assert.ok(recorded.some(({ bottom }) => bottom === 0), 'the builder emits the actual curb and paving');
  assert.ok(recorded.some(({ bottom }) => bottom === 0.3), 'the builder emits the actual lawn');
  for (const [x, z] of [[-782.24, -1227.25], [-782.11, -1227.45]]) {
    assert.ok(!recorded.some(({ pts, holes }) => inside(pts, x, z) && !holes.some((h) => inside(h, x, z))),
      `park surface covers the Pułaskiego carriageway at ${x}, ${z}`);
    assert.equal(config.blockAt(x, z), null, 'roadway is not raised ground');
  }
  let samples = 0;
  for (const road of GEO.roads.filter((r) => r[0] === 'Kazimierza Pułaskiego')) {
    const p = road[5];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, az, bx, bz] = p.slice(i, i + 4);
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      for (let s = 0; s <= len; s += 0.5) {
        for (const side of [-0.4 * road[1], 0, 0.4 * road[1]]) {
          const x = ax + dx * s / len - dz * side / len, z = az + dz * s / len + dx * side / len;
          if (!inside(block.poly, x, z)) continue;
          samples++;
          assert.ok(!recorded.some(({ pts, holes }) => inside(pts, x, z) && !holes.some((h) => inside(h, x, z))),
            `park covers a sample of Pułaskiego at ${x.toFixed(2)}, ${z.toFixed(2)}`);
        }
      }
    }
  }
  assert.ok(samples > 5, 'the sampled carriageway actually enters the original island');
  const point = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const offset = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const f = vm.runInNewContext(`${point}\n${offset}\n${area}\n${clipping}\n({ offsetPolygonInward, triangulateRing, polygonCentroidArea })`);
  const slab = f.offsetPolygonInward(block.poly, 0.1);
  const bed = f.offsetPolygonInward(block.poly, 0.8);
  for (const ring of [block.poly, slab, bed, f.offsetPolygonInward(bed, 0.3)]) {
    const triangles = f.triangulateRing(ring);
    const sum = triangles.reduce((n, t) => n + f.polygonCentroidArea(t), 0);
    assert.ok(Math.abs(sum - Math.abs(f.polygonCentroidArea(ring))) < 0.001, 'source ring triangulates without overlapping');
  }
  const lawnArea = recorded.filter(({ bottom }) => bottom === 0.3).reduce((sum, { pts }) => sum + f.polygonCentroidArea(pts), 0);
  assert.ok(lawnArea > block.area * 0.8, 'most of the island remains lawn');
  assert.ok(recorded.every(({ holes }) => holes.length === 0), 'this island has no pond holes to split when clipping');
});
