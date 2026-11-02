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

test('the long Witosa park island leaves the carriageway clear', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const marker = 'const shape = createWorldXZShape(pts, holes);';
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
        if (current && current.minX === -2359 && current.maxX === -1917 && bottom <= 0.3) {
          recorded.push({ pts, bottom, holes });
        }
      } }
  }).buildCityGrid(stub);
  assert.ok(recorded.length > 2, 'the actual park surfaces are observed');
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const f = vm.runInNewContext(`${area}\n${clipping}\n({ triangulateRing, polygonCentroidArea })`);
  const block = config.BLOCKS.find((b) => b.minX === -2359 && b.maxX === -1917 && b.minZ === -2830);
  assert.ok(block, 'the opposite island exists');
  const segments = [];
  for (const road of GEO.roads.filter((r) => r[0] === 'Wincentego Witosa' || r[0] === 'Niestachowska')) {
    for (let i = 0; i + 3 < road[5].length; i += 2) {
      const [ax, az, bx, bz] = road[5].slice(i, i + 4);
      if (Math.max(ax, bx) < block.minX - 15 || Math.min(ax, bx) > block.maxX + 15 ||
        Math.max(az, bz) < block.minZ - 15 || Math.min(az, bz) > block.maxZ + 15) continue;
      segments.push([ax, az, bx, bz, road[1] / 2]);
    }
  }
  assert.ok(segments.length, 'nearby road corridors exist');
  let lawnArea = 0;
  for (const { pts, bottom } of recorded) {
    const triangles = f.triangulateRing(pts);
    const sum = triangles.reduce((a, t) => a + f.polygonCentroidArea(t), 0);
    assert.ok(Math.abs(sum - Math.abs(f.polygonCentroidArea(pts))) < 0.001, 'emitted surface triangulates without overlapping');
    if (bottom === 0.3) lawnArea += sum;
  }
  assert.ok(lawnArea > block.area * 0.7, 'most of the lawn remains');
  for (const [ax, az, bx, bz, half] of segments) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    for (let s = 0; s <= len; s += 0.5) {
      for (const side of [-0.98 * half, 0, 0.98 * half]) {
        const x = ax + dx * s / len - dz * side / len, z = az + dz * s / len + dx * side / len;
        assert.ok(!recorded.some(({ pts, holes }) => inside(pts, x, z) && !holes.some((h) => inside(h, x, z))),
          `park surface covers a roadway at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      }
    }
  }
});
