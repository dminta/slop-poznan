import assert from 'node:assert/strict';
import test from 'node:test';
import { auditStreetTrees } from '../tools/audit-street-tree-clearance.mjs';

// Historical real-world baseline: 655 / 5 / 25 / 8. Real placement is checked on the existing distribution fixture;
// this small oracle test keeps each violation kind independently observable without building another city.
test('street-tree audit distinguishes landing, zebra, lane and off-island violations', () => {
  const block = {};
  const config = { blockAt: (x, z) => x >= 0 && x <= 100 && z >= 0 && z <= 100 ? block : null };
  const sites = [[10, 10], [20, 20], [30, 30], [99.9, 50], [50, 50]]
    .map(([x, z]) => ({ x, z, scale: 1, tier: 2 }));
  const result = auditStreetTrees({ sites, config,
    network: { nodes: [], edges: [{ x0: 29.2, z0: 25, dx: 0, dz: 1, rx: -1, rz: 0, span: 10, lanes: [0] }] },
    routes: { crosswalks: [{ ax: 18, az: 20, bx: 22, bz: 20 }] },
    clearOfCrosswalks: (x) => x !== 10,
    grid: { footprints: [] }, details: { footprints: [] }
  });
  assert.deepEqual(result.counts, { landing: 1, zebra: 1, lane: 1, island: 1 });
  for (const [kind, i] of [['landing', 0], ['zebra', 1], ['lane', 2], ['island', 3]]) {
    assert.equal(result.violations[kind][0], sites[i], `${kind} reports the offending trunk`);
  }
});

test('street-tree audit catches trunk overlap with tram traction poles', () => {
  const block = {};
  const config = { blockAt: () => block };
  const sites = [
    { x: 10, z: 10, scale: 1, tier: 2 }, // 0.30 m from pole (< 0.28 + 0.16 + 0.15 = 0.59 m)
    { x: 20, z: 20, scale: 1, tier: 2 }  // 1.00 m from pole (clear)
  ];
  const result = auditStreetTrees({ sites, config,
    network: { nodes: [], edges: [] },
    routes: { crosswalks: [] },
    clearOfCrosswalks: () => true,
    grid: { footprints: [] }, details: { footprints: [] },
    helpers: {},
    tram: { platformPieceRects: () => [], shelterRect: () => ({}) },
    tramLayout: { tracks: [], stops: [], poles: [{ x: 10.3, z: 10 }, { x: 21.0, z: 20 }] }
  });
  assert.equal(result.extraCounts.tramPoleOverlap, 1);
});
