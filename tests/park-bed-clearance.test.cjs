const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('Park Maciejewski bed stays inside its curb island at Św. Marcin', () => {
  const source = readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8');
  const geometry = source.slice(source.indexOf('function offsetPolygonInward'), source.indexOf('function polygonCentroidArea'));
  const pointTest = source.slice(source.indexOf('function pointInPolygonXZ'), source.indexOf('/** Polygon offset'));
  const { offsetPolygonInward, parkBedOutline, pointInPolygonXZ } = vm.runInNewContext(
    `${geometry}\n${pointTest}\n({ offsetPolygonInward, parkBedOutline, pointInPolygonXZ })`
  );
  const data = readFileSync(join(__dirname, '../js/geodata.js'), 'utf8').replace('export const GEO =', 'globalThis.GEO =');
  const context = {};
  vm.runInNewContext(data, context);
  const raw = context.GEO.blocks.find((b) => b[3] === 'Park Romana Maciejewskiego' && b[2] > 0.6);
  assert.ok(raw);
  const poly = [];
  for (let i = 0; i < raw[0].length; i += 2) poly.push({ x: raw[0][i], z: raw[0][i + 1] });
  const bed = offsetPolygonInward(parkBedOutline({ poly, parkName: raw[3] }), 5);
  assert.ok(bed);
  for (let i = 0; i < bed.length; i++) {
    const a = bed[i], b = bed[(i + 1) % bed.length];
    for (let t = 0; t < 1; t += 0.05) {
      assert.ok(pointInPolygonXZ(poly, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
    }
  }
});
