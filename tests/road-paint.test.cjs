const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The markings road-paint.js lays on a hand-built network, read back from its geometry: one quad per strip
// (vertices a-, a+, b+, b-), with its colour and dash pattern (paint: phase, period, duty)
function paintOf(edges) {
  let geometry = null;
  class Color { constructor(hex) { this.r = (hex >> 16) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; } }
  class BufferGeometry { constructor() { this.a = {}; geometry = this; } setAttribute(k, v) { this.a[k] = v.array; } setIndex() {} }
  class Attribute { constructor(array) { this.array = array; } }
  const THREE = { Color, BufferGeometry, Float32BufferAttribute: Attribute, BufferAttribute: Attribute, Mesh: class {} };
  const { buildRoadPaint } = loadModule(readFileSync(join(__dirname, '../js/road-paint.js'), 'utf8'), {
    imports: { 'three/webgpu': THREE, './road-network.js': { CROSSWALK: 4.3 }, './tsl-materials.js': { createRoadPaintMaterial: () => ({}) } },
    filename: 'road-paint.js'
  });
  buildRoadPaint({ add() {} }, { edges, paintEdges: edges });
  const { position: p, color: c, paint } = geometry.a;
  const quads = [];
  for (let v = 0; v < p.length / 3; v += 4) {
    quads.push({
      w: Math.hypot(p[v * 3 + 3] - p[v * 3], p[v * 3 + 5] - p[v * 3 + 2]),
      len: Math.hypot(p[v * 3 + 9] - p[v * 3], p[v * 3 + 11] - p[v * 3 + 2]),
      red: c[v * 3] > c[v * 3 + 2] + 0.2,
      white: c[v * 3] > 0.8 && c[v * 3 + 2] > 0.8,
      period: paint[v * 3 + 1],
      duty: paint[v * 3 + 2]
    });
  }
  return quads;
}

// A straight east-west road, 100 m between two junctions (stop lines 10 m in), as road-network.js paintEdges
function road({ half, lanes, back = lanes, limit = 50 / 3.6, signal = false, bike = [false, false] }) {
  const A = { id: 0, x: 0, z: 0, shape: false, signal };
  const B = { id: 1, x: 100, z: 0, shape: false, signal };
  const edge = (from, to, dx, ln, b) => ({
    from, to, x0: from.x, z0: 0, sx: from.x + dx * 10, sz: 0, dx, dz: 0, rx: 0, rz: dx, span: 100, len: 80, half,
    lanes: ln, limit, bike: b
  });
  const edges = [edge(A, B, 1, lanes, bike)];
  if (back) edges.push(edge(B, A, -1, back, [bike[1], bike[0]]));
  return edges;
}

test('all markings are white or red, with P-10 zebras 4 m deep in 0.5 m stripes', () => {
  const quads = paintOf(road({ half: 7, lanes: [1.8, 5.4], signal: true }));
  assert.ok(quads.every((q) => q.white || q.red), 'no yellow');
  const zebras = quads.filter((q) => q.period === 1 && q.duty === 0.5);
  assert.equal(zebras.length, 2);
  assert.ok(zebras.every((q) => Math.abs(q.w - 4) < 1e-6 && Math.abs(q.len - 14) < 1e-6));
});

test('opposing lanes: P-4 double solid on multi-lane roads, dashed or nothing on single-lane ones', () => {
  const solid = (qs) => qs.filter((q) => q.white && q.period === 1 && Math.abs(q.w - 0.12) < 1e-6);
  const dashed = (qs) => qs.filter((q) => q.white && q.period === 12);
  const wide = paintOf(road({ half: 7.5, lanes: [1.8, 5.4] }));
  assert.equal(solid(wide).length, 2, 'the double line');
  assert.equal(dashed(wide).length, 2, 'a lane line each way');
  const narrow = paintOf(road({ half: 3.5, lanes: [1.75] }));
  assert.equal(solid(narrow).length, 0);
  assert.equal(dashed(narrow).length, 1, 'a dashed centre line at 50 km/h');
  assert.equal(dashed(paintOf(road({ half: 3.5, lanes: [1.75], limit: 30 / 3.6 }))).length, 0, 'none in a 30 zone');
});

test('P-14 stop lines only at signalised junctions', () => {
  const stops = (qs) => qs.filter((q) => Math.abs(q.w - 0.5) < 1e-6 && q.period === 1.5);
  assert.equal(stops(paintOf(road({ half: 5, lanes: [1.8], signal: true }))).length, 2);
  assert.equal(stops(paintOf(road({ half: 5, lanes: [1.8] }))).length, 0);
});

test('red bike lanes along tagged curbs where the outer lane leaves room', () => {
  const red = (qs) => qs.filter((q) => q.red);
  // one-way, 10 m wide, two lanes centred: 3.2 m from the outer lanes to each curb
  const oneWay = { half: 5, lanes: [-1.8, 1.8], back: null };
  assert.equal(red(paintOf(road({ ...oneWay, bike: [false, true] }))).length, 1);
  assert.equal(red(paintOf(road({ ...oneWay, bike: [true, true] }))).length, 2);
  assert.equal(red(paintOf(road(oneWay))).length, 0, 'untagged');
  assert.ok(red(paintOf(road({ ...oneWay, bike: [false, true] }))).every((q) => Math.abs(q.w - 1.5) < 1e-6));
  assert.equal(red(paintOf(road({ half: 3.5, lanes: [1.75], bike: [true, true] }))).length, 0, 'no room');
});
