// Pins the shared separating-axis penetration used by the tram–tram and car–tram audits. The 5 cm tolerance is only
// meaningful if zero is exactly touching and a shallow overlap reports its true depth, so check all four boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exceedsTolerance, penetration, overlap } from '../tools/rect-penetration.mjs';

const square = (x, z, hl = 1, hw = 1, h = 0) => ({ x, z, h, hl, hw });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('separated rectangles report a negative penetration', () => {
  const depth = penetration(square(0, 0), square(3, 0));
  near(depth, -1);
  assert.equal(overlap(square(0, 0), square(3, 0)), false);
});

test('touching rectangles report zero and still count as overlap', () => {
  const depth = penetration(square(0, 0), square(2, 0));
  near(depth, 0);
  assert.equal(overlap(square(0, 0), square(2, 0)), true);
});

test('a 3 cm overlap reports 0.03 m', () => {
  const depth = penetration(square(0, 0), square(1.97, 0));
  near(depth, 0.03);
  assert.ok(depth > 0.005 && depth < 0.05);
});

test('a 10 cm overlap reports 0.10 m', () => {
  const depth = penetration(square(0, 0), square(1.9, 0));
  near(depth, 0.1);
  assert.ok(depth > 0.05);
});

test('the shallowest axis decides a rotated, non-square pair', () => {
  const a = square(0, 0, 2, 0.5);
  const b = square(0, 0.5, 2, 0.5, Math.PI / 2);
  // Crossed 4 x 1 m bodies: the x axis leaves 2.5 m of shared half-extent, the z axis only 2 m after the offset.
  near(penetration(a, b), 2);
  near(penetration(a, square(1.1, 0, 2, 0.5)), -0.1);
});

test('the 5 cm tolerance drops tangencies and 3 cm cuts, keeps 10 cm', () => {
  assert.equal(exceedsTolerance(penetration(square(0, 0), square(2, 0)), 0.05), false);
  assert.equal(exceedsTolerance(penetration(square(0, 0), square(1.97, 0)), 0.05), false);
  assert.equal(exceedsTolerance(penetration(square(0, 0), square(1.9, 0)), 0.05), true);
  // Tolerance 0 keeps the recorded touching-inclusive count, which the raw `overlapPairs` still uses.
  assert.equal(exceedsTolerance(0, 0), true);
  assert.equal(exceedsTolerance(-1e-9, 0), false);
});
