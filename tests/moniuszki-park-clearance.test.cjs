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

test('Park Moniuszki emits simple lawn and coping inside its block beside Chopina', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const offset = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const point = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const f = vm.runInNewContext(`${offset}\n${point}\n${area}\n${clipping}\n({ offsetPolygonInward, pointInPolygonXZ, triangulateRing, polygonCentroidArea })`);
  const b = config.BLOCKS.find((b) => b.parkName === 'Park Stanisława Moniuszki');
  assert.ok(b);
  const oldBed = f.offsetPolygonInward(b.poly, 5);
  assert.ok(oldBed.some((p) => !f.pointInPolygonXZ(b.poly, p.x, p.z)), 'the old inset escapes the park');
  const bed = f.offsetPolygonInward(b.poly, 0.8);
  const lawn = f.offsetPolygonInward(bed, 0.3);
  const recorded = [];
  const marker = 'const shape = createWorldXZShape(pts, holes);';
  assert.ok(source.includes(marker));
  const stub = inert();
  const grid = loadModule(source.replace(marker, 'recordPolygon(pts, bottomY, height);\n  ' + marker), {
    imports: { 'three/webgpu': stub, 'three/tsl': stub, 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} }, recordPolygon: (pts, bottom, height) => {
      if ((bottom === 0.2 || bottom === 0.3) && pts.length === b.poly.length) recorded.push({ pts, bottom, height });
    } }
  });
  grid.buildCityGrid(stub);
  const same = (a, c) => a.length === c.length && a.every((p, i) => Math.hypot(p.x - c[i].x, p.z - c[i].z) < 1e-6);
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const [ring, bottom] of [[bed, 0.2], [lawn, 0.3]]) {
    assert.ok(recorded.some((p) => p.bottom === bottom && same(p.pts, ring)), 'the actual builder emits the corrected ring');
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      for (let t = 0; t < 1; t += 0.02) {
        assert.ok(f.pointInPolygonXZ(b.poly, a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t), 'edge stays inside park');
      }
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        const p = ring[j], q = ring[(j + 1) % ring.length];
        assert.ok(!(cross(a, c, p) * cross(a, c, q) < 0 && cross(p, q, a) * cross(p, q, c) < 0),
          'non-adjacent edges do not cross');
      }
    }
    const triangles = f.triangulateRing(ring);
    const triangleArea = triangles.reduce((sum, p) => sum + f.polygonCentroidArea(p), 0);
    assert.ok(Math.abs(triangleArea - Math.abs(f.polygonCentroidArea(ring))) < 0.001, 'ring triangulates without overlap');
    assert.ok(triangleArea > 17000, 'most of the park remains green');
    assert.ok(!triangles.some((t) => f.pointInPolygonXZ(t, -1044.5, -634.5)), 'road point is outside every triangle');
  }
  assert.equal(config.blockAt(-1044.5, -634.5), null, 'the affected road point remains roadway');
});
