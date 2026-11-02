const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('park bed and lawn remain simple and clear both carriageways near Armii Poznań', async () => {
  const { BLOCKS } = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const offset = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const point = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const area = source.slice(source.indexOf('function polygonCentroidArea'), source.indexOf('function ', source.indexOf('function polygonCentroidArea') + 10));
  const clipping = source.slice(source.indexOf('function cross2'), source.indexOf('function armiiParkRoadCuts'));
  const cuts = source.slice(source.indexOf('function armiiParkRoadCuts'), source.indexOf('\n}', source.indexOf('function armiiParkRoadCuts')) + 2);
  const f = vm.runInNewContext(`${offset}\n${point}\n${area}\n${clipping}\n${cuts}\n({ offsetPolygonInward, pointInPolygonXZ, cutSlab, armiiParkRoadCuts, triangulateRing, polygonCentroidArea })`, { GEO });
  const block = BLOCKS.find((b) => b.minX === -1003.5 && b.minZ === -2060 && b.maxX === -727.5);
  assert.ok(block);
  const segments = f.armiiParkRoadCuts(block);
  const bed = f.offsetPolygonInward(block.poly, 0.8);
  const lawn = f.offsetPolygonInward(bed, 0.3);
  for (const ring of [bed, lawn]) {
    const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    for (let i = 0; i < ring.length; i++) {
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], d = ring[(j + 1) % ring.length];
        assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0),
          'inset edges do not cross');
      }
    }
    const triangles = f.triangulateRing(ring);
    const sum = triangles.reduce((total, t) => total + f.polygonCentroidArea(t), 0);
    assert.ok(Math.abs(sum - Math.abs(f.polygonCentroidArea(ring))) < 0.001, 'ring triangulates without overlapping');
    for (const p of ring) assert.ok(f.pointInPolygonXZ(block.poly, p.x, p.z), 'inset stays inside the block');
  }
  const original = f.offsetPolygonInward(block.poly, 5);
  assert.ok(f.pointInPolygonXZ(original, -995.487, -1675.626), 'old bed covers the road');
  const surfaces = [bed, lawn].flatMap((ring) => f.cutSlab(ring, segments, 0));
  assert.ok(surfaces.length > 0);
  for (const [ax, az, bx, bz, half] of segments) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    for (let t = 0; t <= 1; t += 1 / Math.ceil(len)) {
      for (const side of [-half + 0.5, 0, half - 0.5]) {
        const x = ax + dx * t + dz / len * side, z = az + dz * t - dx / len * side;
        assert.ok(!surfaces.some((p) => f.pointInPolygonXZ(p, x, z)), `road covered at ${x}, ${z}`);
      }
    }
  }
});
