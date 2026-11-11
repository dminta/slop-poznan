// The load-time point-in-polygon predicates are indexed by z (city-config.js createPolygonIndex / pointInPolyIndexed).
// The index must be a pure speed-up: a point exactly on a vertex, an edge or a slot boundary has to give the same
// answer as the plain ray cast, including the endpoint pairing that decides an on-edge tie.
const test = require('node:test');
const assert = require('node:assert/strict');

const plainPointInPoly = (poly, x, z) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

const plainFlatRing = (r, x, z) => {
  let ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};

test('indexed block polygons match the plain ray cast on vertices, edges and slot boundaries', async () => {
  const { BLOCKS, pointInBlockPoly, createPolygonIndex, pointInPolyIndexed } = await import('../js/city-config.js');
  let compared = 0;
  for (const b of BLOCKS) {
    assert.ok(b.poly.length >= 3, `block ${b.id} is a polygon`);
    // Points on every vertex and edge midpoint, and a hair either side, land on the tie cases the index must preserve.
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      for (const t of [0, 0.5]) {
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        for (const d of [0, -1e-6, 1e-6]) {
          assert.equal(pointInBlockPoly(b, x + d, z), plainPointInPoly(b.poly, x + d, z),
            `block ${b.id} at ${x + d},${z}`);
          assert.equal(pointInBlockPoly(b, x, z + d), plainPointInPoly(b.poly, x, z + d),
            `block ${b.id} at ${x},${z + d}`);
          compared += 2;
        }
      }
    }
    // An unindexed polygon through pointInPolyIndexed must match too (the shared helper is used outside BLOCKS).
    const index = createPolygonIndex(b.poly);
    for (let x = b.minX; x <= b.maxX; x += Math.max(3, (b.maxX - b.minX) / 7)) {
      for (let z = b.minZ; z <= b.maxZ; z += Math.max(3, (b.maxZ - b.minZ) / 7)) {
        assert.equal(pointInPolyIndexed(b.poly, index, x, z), plainPointInPoly(b.poly, x, z),
          `block ${b.id} interior ${x},${z}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 100000, `compared ${compared} block points`);
});

test('indexed park rings match the plain ring test, including the polygon bounds rejection', async () => {
  const { PARK_RINGS, pointInPark, createPolygonIndex, pointInPolyIndexed } = await import('../js/city-config.js');
  const plainPark = (x, z) => PARK_RINGS.some((p) =>
    x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && plainFlatRing(p.r, x, z));
  let compared = 0;
  for (const p of PARK_RINGS) {
    const index = createPolygonIndex(p.pts);
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i], c = p.pts[(i + 1) % p.pts.length];
      for (const t of [0, 0.5]) {
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        for (const d of [0, -1e-6, 1e-6]) {
          assert.equal(pointInPolyIndexed(p.pts, index, x, z), plainFlatRing(p.r, x, z),
            `park ring ${p.x0},${p.z0} at ${x},${z}`);
          assert.equal(pointInPark(x, z + d), plainPark(x, z + d), `pointInPark at ${x},${z + d}`);
          compared += 2;
        }
      }
    }
  }
  assert.ok(compared > 100000, `compared ${compared} park points`);
});

test('a synthetic polygon gives the same answer at every slot boundary', async () => {
  const { createPolygonIndex, pointInPolyIndexed } = await import('../js/city-config.js');
  // Edges cross several 4 m z slots and one is exactly horizontal; vertices sit on slot boundaries.
  const poly = [
    { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 7, z: 4 },
    { x: 7, z: 8 }, { x: 3, z: 8 }, { x: 3, z: 12 }, { x: 0, z: 12 }
  ];
  const index = createPolygonIndex(poly);
  for (let x = -1; x <= 11; x += 0.5) {
    for (let z = -1; z <= 13; z += 0.5) {
      for (const dx of [0, -1e-9, 1e-9]) {
        assert.equal(pointInPolyIndexed(poly, index, x + dx, z), plainPointInPoly(poly, x + dx, z),
          `synthetic at ${x + dx},${z}`);
      }
    }
  }
});

test('a 4096 m span keeps the last slot reachable one ulp below z1 and at interior slot boundaries', async () => {
  const { createPolygonIndex, pointInPolyIndexed } = await import('../js/city-config.js');
  // The old filing used floor((lo - z0) / 4) while z0 + s * 4 < hi, and the query used floor((z - z0) / 4) >= slots.
  // At z = -1e-13, z - z0 rounds to 4096 and the query fell past the last slot even though the point is inside.
  const poly = [{ x: 0, z: -4096 }, { x: 20, z: -4096 }, { x: 20, z: 0 }, { x: 0, z: 0 }];
  const index = createPolygonIndex(poly);
  const check = (z) => {
    const plain = plainPointInPoly(poly, 10, z);
    assert.equal(pointInPolyIndexed(poly, index, 10, z), plain, `4096 m rectangle at z=${z}`);
    return plain;
  };
  assert.equal(check(-1e-13), true, 'one ulp below z1 is inside');
  assert.equal(check(1e-13), false, 'one ulp above z1 is outside');
  assert.equal(check(0), false);
  // At the minimum z the vertex tie-break leaves the point inside (the ray meets the upward side), which is the
  // behavior the endpoint pairing must preserve.
  assert.equal(check(-4096), true);
  // Every interior slot boundary, with values that round to the boundary or one slot either side.
  for (let z = -4096; z <= 0; z += 4) {
    assert.equal(check(z), plainPointInPoly(poly, 10, z), `slot boundary ${z}`);
    for (const d of [-1e-13, 1e-13, -1e-12, 1e-12]) check(z + d);
  }
});
