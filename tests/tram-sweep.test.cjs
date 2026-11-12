const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const tram = loadModule(readFileSync(join(__dirname, '../js/trams.js'), 'utf8'), { imports: {
  'three/webgpu': {}, './geodata.js': {}, './city-config.js': {}, './tsl-materials.js': {},
  './actor-models.js': {}, './vehicle-lights.js': {}
} });
const chain = (pts) => ({ kind: 'tram', street: 1, tracks: 1, oneway: 1, routes: [0], pts });

test('section sweep uses the rendered rigid length on a circular chord', async () => {
  const { rectangleDepth } = await import('../tools/tram-sweep-geometry.mjs');
  const radius = 20, length = 11.8;
  const pointAt = (u, p) => Object.assign(p, {
    x: radius * Math.cos(u / radius), z: radius * Math.sin(u / radius)
  });
  const out = [{}];
  tram.poseSections({ pointAt }, length / 2, { sections: [{ len: length }], gap: 0 }, out);
  const section = out[0];
  assert.ok(Math.abs(section.x - radius * Math.cos(length / (2 * radius))) < 1e-12);
  assert.ok(Math.abs(section.z) < 1e-12);
  assert.equal(section.halfLength, length / 2, 'the rendered body is longer than the chord on a bend');
  assert.equal(section.halfWidth, tram.TRAM_HALF_WIDTH);
  const car = { x: section.x, z: 0, heading: 0, halfLength: 2.8, halfWidth: 1.01 };
  assert.ok(rectangleDepth(car, section) > 0);
  assert.ok(rectangleDepth({ ...car, x: 30 }, section) < 0);
});

test('spatial sweep agrees with a plain sampled section reference and clears a retreated car', async () => {
  const { buildSectionSweep, rectangleDepth } = await import('../tools/tram-sweep-geometry.mjs');
  const graph = tram.buildTrackGraph([chain([-30, 0, 0, 0, 10, 5, 15, 15, 15, 40])]);
  const edge = graph.edges[0], len = 11.8, margin = 0.1, step = 0.5;
  const models = { one: { sections: [{ len }], gap: 0 } };
  const sweep = buildSectionSweep(graph, models, tram.edgePoint, tram.poseSections, { margin, step });
  const reference = [], out = [{}], a = {}, b = {}, m = {};
  const path = { pointAt: (s, p) => tram.edgePoint(edge, s, p) };
  for (let s = 0; s < edge.len; s += step) {
    path.pointAt(s, a); path.pointAt(s + len, b); path.pointAt(s + len / 2, m);
    const ux = b.x - a.x, uz = b.z - a.z, d = Math.hypot(ux, uz);
    if (Math.abs(ux * a.tz - uz * a.tx) / d <= 1e-6 &&
        Math.abs(ux * b.tz - uz * b.tx) / d <= 1e-6 &&
        Math.abs(ux * (m.z - a.z) - uz * (m.x - a.x)) / d <= 1e-6) continue;
    tram.poseSections(path, s + len, models.one, out);
    reference.push({ ...out[0], halfLength: len / 2 + margin, halfWidth: 1.2 + margin });
  }
  assert.equal(sweep.count, reference.length);
  for (let x = -16; x <= 24; x += 2) for (let z = -16; z <= 32; z += 2) {
    const car = { x, z, heading: 0.3, halfLength: 2.8, halfWidth: 1.01 };
    const expected = Math.max(0, ...reference.map((r) => rectangleDepth(car, r)));
    assert.ok(Math.abs(sweep.intrusion(car).depth - expected) < 1e-12, `${x},${z}`);
  }
  const car = { x: 8, z: 5, heading: Math.PI / 2, halfLength: 2.8, halfWidth: 1.01 };
  assert.ok(sweep.intrusion(car).depth > 0, 'positive control catches an unsafe standing position');
  assert.equal(sweep.intrusion({ ...car, x: -20 }).depth, 0, 'a position outside the sweep clears');
});

test('sweep crosses short switch pieces rather than extrapolating their tangent', async () => {
  const { buildSectionSweep } = await import('../tools/tram-sweep-geometry.mjs');
  const graph = tram.buildTrackGraph([
    chain([-20, 0, 0, 0]), chain([0, 0, 3, 1]), chain([3, 1, 5, 3, 7, 10])
  ]);
  const sweep = buildSectionSweep(graph, tram.TRAM_MODELS, tram.edgePoint, tram.poseSections);
  assert.ok(sweep.count > 0);
  assert.ok(sweep.intrusion({ x: 3, z: 2, heading: 0, halfLength: 1, halfWidth: 1 }).depth > 0);
  assert.equal(sweep.intrusion({ x: -15, z: -10, heading: 0, halfLength: 1, halfWidth: 1 }).depth, 0);
});

test('straight shared track is excluded from a turning-sweep setback diagnosis', async () => {
  const { buildSectionSweep } = await import('../tools/tram-sweep-geometry.mjs');
  const graph = tram.buildTrackGraph([chain([-40, 0, 40, 0])]);
  const sweep = buildSectionSweep(graph, tram.TRAM_MODELS, tram.edgePoint, tram.poseSections);
  assert.equal(sweep.count, 0);
});

test('an S bend is still curved when its chord midpoint and end tangents align', async () => {
  const { buildSectionSweep } = await import('../tools/tram-sweep-geometry.mjs');
  const graph = tram.buildTrackGraph([chain([0, 0, 1, 0, 2, 1, 3, 0, 4, -1, 5, 0, 6, 0])]);
  const len = graph.edges[0].len;
  const sweep = buildSectionSweep(graph, { one: { sections: [{ len }], gap: 0 } },
    tram.edgePoint, tram.poseSections, { step: len + 1 });
  assert.equal(sweep.count, 1, 'the whole-section chord needs the vertex check');
});

test('a returned stop-line retreat clears the envelope and preserves the required storage', async () => {
  const { findStandingRetreat, rectangleDepth } = await import('../tools/tram-sweep-geometry.mjs');
  const track = { x: 0, z: 0, heading: Math.PI / 2, halfLength: 10, halfWidth: 1.3 };
  const rectAt = (back) => ({ x: 0, z: -back, heading: 0, halfLength: 2.8, halfWidth: 1.01 });
  const sweep = { intrusion: (r) => ({ depth: Math.max(0, rectangleDepth(r, track)) }) };
  const result = findStandingRetreat(rectAt, sweep, 10);
  assert.equal(result.retreat, 4.25);
  assert.equal(sweep.intrusion(rectAt(result.retreat)).depth, 0);
  assert.ok(sweep.intrusion(rectAt(result.retreat - 0.25)).depth > 0, 'the preceding quarter metre is unsafe');
  const short = findStandingRetreat(rectAt, sweep, 4);
  assert.equal(short.retreat, null, 'do not sacrifice one-car storage to clear a short edge');
  assert.equal(short.requiredRetreat, 4.25);
  const noRoom = findStandingRetreat(rectAt, { intrusion: () => ({ depth: 1 }) }, 100);
  assert.equal(noRoom.retreat, null, 'exhausting the search does not invent a safe retreat on a long edge');
  assert.equal(noRoom.requiredRetreat, null);
});
