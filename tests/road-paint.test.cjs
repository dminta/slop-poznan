const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The crosswalks pedestrian-routes.js would lay at both ends of the road below (both curbs on a sidewalk): curb to
// curb, CROSSWALK deep next to each junction, beyond the stop line's setback, u pointing out of the junction
function crosswalksOf(edges) {
  const e = edges[0];
  const cross = (node, s, sign) => {
    const x = e.sx + e.dx * s, z = e.sz + e.dz * s;
    return { node, ax: x - e.rx * e.half, az: z - e.rz * e.half, bx: x + e.rx * e.half, bz: z + e.rz * e.half, ux: e.dx * sign, uz: e.dz * sign };
  };
  return [cross(e.from, -e.setbackFrom - 2.15, 1), cross(e.to, e.len + e.setbackTo + 2.15, -1)];
}

// The markings road-paint.js lays on a hand-built network, read back from its geometry: one quad per strip
// (vertices a-, a+, b+, b-), with its colour and dash pattern (paint: phase, period, duty)
function paintOf(edges, crosswalks = crosswalksOf(edges), railClearance = null) {
  let geometry = null;
  class Color { constructor(hex) { this.r = (hex >> 16) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; } }
  class BufferGeometry { constructor() { this.a = {}; geometry = this; } setAttribute(k, v) { this.a[k] = v.array; } setIndex() {} }
  class Attribute { constructor(array) { this.array = array; } }
  const THREE = { Color, BufferGeometry, Float32BufferAttribute: Attribute, BufferAttribute: Attribute, Mesh: class {} };
  const { buildRoadPaint } = loadModule(readFileSync(join(__dirname, '../js/road-paint.js'), 'utf8'), {
    imports: { 'three/webgpu': THREE, './road-network.js': { CROSSWALK: 4.3, STOP_SETBACK: 1.75 }, './tsl-materials.js': { createRoadPaintMaterial: () => ({}) } },
    filename: 'road-paint.js'
  });
  buildRoadPaint({ add() {} }, { edges, paintEdges: edges }, crosswalks, railClearance);
  const { position: p, color: c, paint } = geometry.a;
  const quads = [];
  for (let v = 0; v < p.length / 3; v += 4) {
    quads.push({
      w: Math.hypot(p[v * 3 + 3] - p[v * 3], p[v * 3 + 5] - p[v * 3 + 2]),
      len: Math.hypot(p[v * 3 + 9] - p[v * 3], p[v * 3 + 11] - p[v * 3 + 2]),
      x: (p[v * 3] + p[v * 3 + 3] + p[v * 3 + 6] + p[v * 3 + 9]) / 4,
      z0: Math.min(p[v * 3 + 2], p[v * 3 + 5], p[v * 3 + 8], p[v * 3 + 11]),
      z1: Math.max(p[v * 3 + 2], p[v * 3 + 5], p[v * 3 + 8], p[v * 3 + 11]),
      phase: paint[v * 3],
      white: c[v * 3] > 0.8 && c[v * 3 + 2] > 0.8,
      period: paint[v * 3 + 1],
      duty: paint[v * 3 + 2]
    });
  }
  return quads;
}

// A straight east-west road, 100 m between two junctions (stop lines 10 m in), as road-network.js paintEdges
function road({ half, lanes, back = lanes, limit = 50 / 3.6, signal = false, setback = 1.75, axis = 'st' }) {
  const A = { id: 0, x: 0, z: 0, shape: false, signal };
  const B = { id: 1, x: 100, z: 0, shape: false, signal };
  const edge = (from, to, dx, ln) => ({
    from, to, axis, x0: from.x, z0: 0, sx: from.x + dx * 10, sz: 0, dx, dz: 0, rx: 0, rz: dx, span: 100, len: 80, half,
    setbackFrom: setback, setbackTo: setback, lanes: ln, limit
  });
  const edges = [edge(A, B, 1, lanes)];
  if (back) edges.push(edge(B, A, -1, back));
  return edges;
}

test('all markings are white, with P-10 zebras 4 m deep in 0.5 m stripes', () => {
  const quads = paintOf(road({ half: 7, lanes: [1.8, 5.4], signal: true }));
  assert.ok(quads.every((q) => q.white), 'no yellow, no red bike lanes');
  const zebras = quads.filter((q) => q.period === 1 && q.duty === 0.5);
  assert.equal(zebras.length, 2);
  assert.ok(zebras.every((q) => Math.abs(q.w - 4) < 1e-6 && Math.abs(q.len - 14) < 1e-6));
});

test('zebras stop short of the tram tracks they cross, the stripes lined up either side', () => {
  // a track down the middle of the road (z = 0): each 14 m zebra splits into two pieces 1.7 m clear of it
  const edges = road({ half: 7, lanes: [1.8, 5.4], signal: true });
  const zebras = paintOf(edges, crosswalksOf(edges), (x, z, r) => Math.min(r, Math.abs(z))).filter((q) => q.period === 1 && q.duty === 0.5);
  assert.equal(zebras.length, 4);
  for (const q of zebras) {
    assert.ok(q.z0 >= 1.7 - 1e-6 || q.z1 <= -1.7 + 1e-6, `a piece over the track: ${q.z0.toFixed(2)} to ${q.z1.toFixed(2)}`);
    assert.ok(q.len > 5.1 && q.len < 5.31, `${q.len.toFixed(2)} m`);
    // its stripe phase is its distance from the zebra's start, so both pieces keep one pattern
    assert.ok(Math.abs(q.phase) < 1e-6 || Math.abs(q.phase - (q.z0 + 7)) < 1e-6, `phase ${q.phase}`);
  }
  // with no track near, the zebras are whole
  const whole = paintOf(edges, crosswalksOf(edges), (x, z, r) => r).filter((q) => q.period === 1 && q.duty === 0.5);
  assert.ok(whole.length === 2 && whole.every((q) => Math.abs(q.len - 14) < 1e-6));
});

test('opposing lanes: P-4 double solid on multi-lane roads, dashed or nothing on single-lane ones', () => {
  const solid = (qs) => qs.filter((q) => q.white && q.period === 1 && Math.abs(q.w - 0.12) < 1e-6);
  const dashed = (qs, period = 6) => qs.filter((q) => q.white && q.period === period && Math.abs(q.duty - 1 / 3) < 1e-6);
  const wide = paintOf(road({ half: 7.5, lanes: [1.8, 5.4] }));
  assert.equal(solid(wide).length, 2, 'the double line');
  assert.equal(dashed(wide).length, 2, 'a P-1b lane line each way (2 m dashes, 4 m gaps)');
  const narrow = paintOf(road({ half: 3.5, lanes: [1.75] }));
  assert.equal(solid(narrow).length, 0);
  assert.equal(dashed(narrow).length, 1, 'a dashed centre line at 50 km/h');
  assert.equal(dashed(paintOf(road({ half: 3.5, lanes: [1.75], limit: 30 / 3.6 }))).length, 0, 'none in a 30 zone');
  assert.equal(dashed(paintOf(road({ half: 2.8, lanes: [1.4] }))).length, 0, 'none under 5.8 m of carriageway');
  assert.equal(dashed(paintOf(road({ half: 7.5, lanes: [1.8, 5.4], limit: 90 / 3.6 })), 12).length, 2,
    'P-1a (4 m dashes, 8 m gaps) above 70 km/h');
});

test('P-14 stop lines of 0.75 m rectangles 0.25 m apart at signals and on major roads', () => {
  const stops = (qs) => qs.filter((q) => Math.abs(q.w - 0.5) < 1e-6 && q.period === 1 && q.duty === 0.75);
  const zebras = (qs) => qs.filter((q) => q.period === 1 && q.duty === 0.5);
  // asphalt between each stop line and the nearest zebra, which must be on the junction side
  const gaps = (quads) => stops(quads).map((s) => {
    const z = zebras(quads).reduce((best, q) => (Math.abs(q.x - s.x) < Math.abs(best.x - s.x) ? q : best));
    assert.ok(Math.abs(z.x - 50) > Math.abs(s.x - 50), 'the zebra beyond the stop line, by the junction');
    return Math.abs(z.x - s.x) - z.w / 2 - s.w / 2;
  });
  assert.equal(stops(paintOf(road({ half: 5, lanes: [1.8], signal: true }))).length, 2, 'signalised');
  assert.equal(stops(paintOf(road({ half: 5, lanes: [1.8] }))).length, 0, 'unsignalised single-lane minor road');
  assert.equal(stops(paintOf(road({ half: 7.5, lanes: [1.8, 5.4] }))).length, 0, 'unsignalised multi-lane minor road');
  const major = { half: 7.5, lanes: [1.8, 5.4], axis: 'ave' };
  assert.equal(stops(paintOf(road(major))).length, 2, 'unsignalised major road (priority, annex 4.2.1)');
  assert.equal(stops(paintOf(road(major), [])).length, 0, 'but not where no zebra crosses it');
  assert.equal(zebras(paintOf(road(major), [])).length, 0, 'zebras only where pedestrian-routes.js has crosswalks');
  assert.equal(stops(paintOf(road({ half: 5, lanes: [1.8], signal: true }), [])).length, 2, 'signals keep theirs');
  assert.equal(stops(paintOf(road({ ...major, lanes: [-1.8, 1.8], back: null }))).length, 1, 'one-way: arriving end only');
  // 2.0 m of asphalt at least between the stop line and the zebra (annex 4.2.5)
  for (const quads of [paintOf(road(major)), paintOf(road({ half: 5, lanes: [1.8], signal: true }))]) {
    for (const gap of gaps(quads)) assert.ok(gap > 2 - 1e-6 && gap < 2.2, `${gap.toFixed(2)} m between P-14 and P-10`);
  }
  // a short link squeezed between corners: a signal keeps its P-14, closer to the zebra but off it; a major road none
  const squeezed = paintOf(road({ half: 5, lanes: [1.8], signal: true, setback: 0 }));
  assert.equal(stops(squeezed).length, 2);
  for (const gap of gaps(squeezed)) assert.ok(gap > 0.2 && gap < 0.3, `${gap.toFixed(2)} m between P-14 and P-10`);
  assert.equal(stops(paintOf(road({ ...major, setback: 0.6 }))).length, 0);
  assert.equal(zebras(paintOf(road({ ...major, setback: 0.6 }))).length, 2);
});

test('P-22 marks only the explicitly designated lane and keeps clear of tracks', () => {
  const source = readFileSync(join(__dirname, '../js/road-paint.js'), 'utf8');
  const { layoutBusMarkings } = loadModule(source, {
    imports: { 'three/webgpu': { Color: class {} }, './road-network.js': {}, './tsl-materials.js': {} }
  });
  const edges = road({ half: 7, lanes: [1.8, 5.4], back: null });
  edges[0].busLanes = [1];
  const marks = layoutBusMarkings(edges, [], () => 100);
  assert.ok(marks.length > 0);
  assert.ok(marks.every((m) => Math.abs(m.z - 5.4) < 1e-6));
  edges[0].busLanes = [];
  assert.equal(layoutBusMarkings(edges, [], () => 100).length, 0);
  edges[0].busLanes = [1];
  assert.equal(layoutBusMarkings(edges, [], (x, z) => Math.abs(z - 5.4)).length, 0);
});

test('P-22 glyphs read left to right across the lane in the direction of travel', () => {
  class Attribute { constructor(array) { this.array = Array.from(array); } }
  class Geometry { constructor() { this.attributes = {}; } setAttribute(k, v) { this.attributes[k] = v; } }
  class Transform {
    constructor() { this.position = { set() {} }; this.rotation = {}; this.matrix = {}; }
    updateMatrix() { this.matrix.rotation = this.rotation.y; }
  }
  class InstancedMesh {
    constructor(geometry, material) { this.geometry = geometry; this.material = material; }
    setMatrixAt(_i, matrix) { this.angle = matrix.rotation; }
  }
  const material = {};
  const { buildBusMarkings } = loadModule(readFileSync(join(__dirname, '../js/road-paint.js'), 'utf8') +
    '\nexport { buildBusMarkings };', {
    imports: { 'three/webgpu': { Color: class {}, BufferGeometry: Geometry, Float32BufferAttribute: Attribute,
      BufferAttribute: Attribute, Object3D: Transform, InstancedMesh }, './road-network.js': {},
    './tsl-materials.js': { createBusPaintMaterial: () => material } }
  });
  let mesh;
  buildBusMarkings({ add(m) { mesh = m; } }, [{ x: 0, z: 0, dx: 1, dz: 0 }]);
  assert.equal(mesh.material, material);
  assert.equal(mesh.renderOrder, -1);
  assert.equal(mesh.angle, Math.PI / 2, 'local +z points along travel');
  const p = mesh.geometry.attributes.position.array;
  const rects = Array.from({ length: p.length / 18 }, (_, n) => {
    const xs = [], zs = [];
    for (let v = 0; v < 6; v++) { xs.push(p[n * 18 + v * 3]); zs.push(p[n * 18 + v * 3 + 2]); }
    return { left: Math.min(...xs), right: Math.max(...xs), low: Math.min(...zs), high: Math.max(...zs) };
  });
  const bounds = (rs) => [Math.min(...rs.map((r) => r.left)), Math.max(...rs.map((r) => r.right)),
    Math.min(...rs.map((r) => r.low)), Math.max(...rs.map((r) => r.high))];
  const [b, u, s] = [rects.slice(0, 5), rects.slice(5, 8), rects.slice(8)];
  const bb = bounds(b), ub = bounds(u), sb = bounds(s), all = bounds(rects);
  assert.ok(Math.abs(all[0] + 0.81) < 1e-6 && Math.abs(all[1] - 0.81) < 1e-6);
  assert.deepEqual(all.slice(2), [-2, 2]);
  assert.ok(bb[0] > ub[1] && ub[0] > sb[1], 'B, U, S from driver left to right');
  assert.ok([bb, ub, sb].every((v) => v[2] === -2 && v[3] === 2));
  assert.ok(b[0].left > b[1].left, 'B stem is on the driver-left side, not mirrored');
  assert.ok(s[0].left > s[1].left && s[0].high === 2 && s[1].low === -2,
    'S upper stem is on the left and its lower stem on the right');
});

test('P-22 uses the lit transparent road-paint SSR pass', () => {
  const vm = require('node:vm');
  const source = readFileSync(join(__dirname, '../js/tsl-materials.js'), 'utf8');
  const start = source.indexOf('function createBusPaintMaterial() {');
  const end = source.indexOf('// Herringbone of 20 x 10 cm', start);
  assert.ok(start >= 0 && end > start);
  const node = new Proxy(() => {}, { get: () => node, apply: () => node });
  class StandardMaterial { constructor(options) { Object.assign(this, options); } }
  const mrt = {};
  const context = { THREE: { MeshStandardNodeMaterial: StandardMaterial }, _transparentEffectMRT: mrt,
    positionWorld: node, cameraPosition: node, smoothstep: node, length: node, mix: node, float: node,
    noise2D: node, roadWetMasks: node, roadPuddleField: node, color: node, canyonSkyAONode: node };
  const material = vm.runInNewContext(`${source.slice(start, end)}\ncreateBusPaintMaterial()`, context);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.mrtNode, mrt);
  assert.ok(material.colorNode && material.roughnessNode && material.opacityNode && material.aoNode);
});
