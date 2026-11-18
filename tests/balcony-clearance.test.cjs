// The balcony filter is a pure top-level block in js/street-details.js, so the closed-form volume and the
// segment/head distance can be checked against the audit's recorded Głogowska row without building the world.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/street-details.js'), 'utf8');
const start = source.indexOf('// --- Balcony clearance against signal elements');
const end = source.indexOf('// --- End of balcony clearance helpers');
assert.ok(start > 0 && end > start, 'balcony clearance markers must stay in street-details.js');
const api = vm.runInNewContext(`${source.slice(start, end)}
  ({ pruneBalconyClashes, balconySegmentGap, balconyHeadPoints, balconyPointGap2 });`, {});

const stack = (o = {}) => ({
  x: 0, z: 0, y: 3.9, storey: 3.8, landings: 3, h: 8.6, facing: 0, ry: 0, w: 2.4, style: 0, ...o
});
const block = (...stacks) => ({ balconies: stacks });
// A vertical pole whose y span only reaches the given landing(s).
const pole = (x, z, y0, y1) => ({ ax: x, ay: y0, az: z, bx: x, by: y1, bz: z, r: 0.1 });
const volume = (b, i) => {
  const angle = (b.ry || 0) + b.facing;
  const width = Math.min(3, Math.max(1.5, b.w));
  return { x: b.x, z: b.z, cs: Math.cos(angle), sn: Math.sin(angle), hw: width / 2, hz: 0.5, zc: -0.05,
    y0: b.y + i * b.storey - 0.14, y1: b.y + i * b.storey + 1.0 };
};
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('the audit geometry reproduces the Głogowska gaps and trims exactly that landing', () => {
  // The recorded pre-fix stack (docs/observations/balcony-spans-2026-11-18.md) and its static pole/head.
  const b = stack({ x: -1972.085, z: 1022.645, y: 3.9, storey: 3.8, landings: 3, h: 8.6,
    facing: Math.PI, ry: 0.7643, w: 2.861 });
  const poleObstacle = pole(-1972.709, 1022.348, 0.1, 4.3);
  const head = { x: -1972.8385, y: 3.55, z: 1022.4734, angle: Math.atan2(-0.130, 0.125),
    hx: 0.15, hy: 0.43, zc: -0.015, hz: 0.285 };
  const v = volume(b, 0);
  assert.ok(Math.abs(api.balconySegmentGap(poleObstacle, v) - 0.096) < 0.01, 'pole gap is the recorded 0.096 m');
  let headGap = Infinity;
  for (const p of api.balconyHeadPoints(head)) {
    headGap = Math.min(headGap, Math.sqrt(api.balconyPointGap2(p[0], p[1], p[2], v)));
  }
  assert.ok(Math.abs(headGap - 0.044) < 0.01, 'head gap is the recorded 0.044 m');

  const far = stack({ x: -1900, z: 1030 });
  const farBefore = { ...far };
  const city = block(b, far);
  const stats = api.pruneBalconyClashes([city], [poleObstacle, head]);
  assert.equal(stats.stacks, 2);
  assert.equal(stats.trimmed, 1);
  assert.equal(stats.dropped, 0);
  assert.equal(stats.landingsRemoved, 1);
  // The bottom landing is gone; the other two keep their slabs and the far box height follows h.
  assert.equal(b.landings, 2);
  near(b.y, 7.7, 'trimmed y');
  near(b.h, 4.8, 'trimmed h');
  assert.deepEqual(far, farBefore);
});

test('a middle or top clash drops the whole stack', () => {
  const middle = stack();
  const top = stack({ x: 20 });
  api.pruneBalconyClashes([block(middle, top)], [
    pole(0, 0.7, 7.0, 9.0), // landing 1 only
    pole(20, 0.7, 11.0, 13.0) // landing 2 only
  ]);
  assert.equal(middle.landings, 3);
  assert.equal(top.landings, 3);
  assert.equal(middle.h, 8.6);
  assert.equal(top.h, 8.6);
});

test('a bottom prefix trims one landing at a time, down to one', () => {
  const four = stack({ landings: 4, h: (4 - 1) * 3.8 + 1 });
  const one = stack({ x: 20, landings: 1, h: 1 });
  const city = block(four, one);
  // A pole that overlaps only landing 0 (3.76..4.90) and one that overlaps the single landing of `one`.
  const stats = api.pruneBalconyClashes([city], [
    pole(0, 0.7, 3.0, 5.5),
    pole(20, 0.7, 3.0, 5.5)
  ]);
  assert.equal(stats.trimmed, 1);
  assert.equal(stats.dropped, 1);
  assert.equal(stats.landingsRemoved, 1);
  assert.equal(four.landings, 3);
  near(four.y, 7.7, 'trimmed y');
  near(four.h, (3 - 1) * 3.8 + 1, 'trimmed h');
  // The 1-landing stack cannot lose its only landing, so it disappears.
  assert.deepEqual(city.balconies, [four]);
});

test('a bottom prefix of two landings leaves the stack minus two', () => {
  const b = stack();
  const stats = api.pruneBalconyClashes([block(b)], [pole(0, 0.7, 3.0, 10.0)]);
  assert.equal(stats.trimmed, 1);
  assert.equal(stats.landingsRemoved, 2);
  assert.equal(b.landings, 1);
  near(b.y, 11.5, 'trimmed y');
  near(b.h, 1, 'trimmed h');
});

test('clear stacks and empty inputs are untouched', () => {
  const b = stack();
  const before = { ...b };
  const clear = api.pruneBalconyClashes([block(b), { balconies: [] }], [pole(0, 5, 0.1, 12)]);
  assert.equal(clear.stacks, 1);
  assert.equal(clear.trimmed, 0);
  assert.equal(clear.dropped, 0);
  assert.equal(clear.landingsRemoved, 0);
  assert.deepEqual(b, before);
  assert.equal(api.pruneBalconyClashes([block(b)], []).stacks, 1);
  assert.equal(api.pruneBalconyClashes([], []).stacks, 0);
});
