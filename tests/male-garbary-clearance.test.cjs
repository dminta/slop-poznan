const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('the Małe Garbary carriageway is not raised by the park island', async () => {
  const { blockAt } = await import('../js/city-config.js');
  for (const [x, z] of [[-40.1, -284.5], [-20.6, -289.6], [4.1, -294.3], [40.7, -306.2]]) {
    assert.equal(blockAt(x, z), null, `roadway at ${x}, ${z} must not be raised`);
  }
});

test('the clipped park surfaces leave the roadway clear', async () => {
  const { BLOCKS } = await import('../js/city-config.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const offset = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const point = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const f = vm.runInNewContext(`${offset}\n${point}\n${area}\n${clipping}\n({ offsetPolygonInward, pointInPolygonXZ, cutSlab, triangulateRing, polygonCentroidArea })`);
  const b = BLOCKS.find((b) => b.minX === -60 && b.maxX === 284 && b.minZ === -317.5 && b.maxZ === -255);
  assert.ok(b && b.roadCut, 'the Małe Garbary island has its road cut');
  const slab = f.offsetPolygonInward(b.poly, 0.1) || b.poly;
  const bed = f.offsetPolygonInward(b.poly, 0.8);
  const lawn = bed && f.offsetPolygonInward(bed, 0.3);
  for (const ring of [b.poly, slab, bed, lawn].filter(Boolean)) {
    const triangles = f.triangulateRing(ring);
    const areaSum = triangles.reduce((sum, p) => sum + f.polygonCentroidArea(p), 0);
    assert.ok(Math.abs(areaSum - Math.abs(f.polygonCentroidArea(ring))) < 0.001, `surface triangulates without overlap: ${ring.length} ${areaSum} ${f.polygonCentroidArea(ring)}`);
    const pieces = f.cutSlab(ring, b.roadCut, 0);
    for (const [x, z] of [[-20.6, -289.6], [4.1, -294.3], [40.7, -306.2]]) {
      assert.ok(!pieces.some((p) => f.pointInPolygonXZ(p, x, z)), `surface covers roadway at ${x}, ${z}`);
    }
  }
});
