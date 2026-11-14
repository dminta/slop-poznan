const assert = require('node:assert/strict');
const test = require('node:test');

test('roadClearance returns exact distance up to 6 m across 32 m cell boundaries', async () => {
  const { roadClearance } = await import('../js/city-config.js');
  // Real Poznań cell-boundary points (x = 3263.83 is 0.17 m west of 102 * 32 = 3264;
  // x = -2080.06 is 0.06 m west of -65 * 32 = -2080). With the old half + 4 m padding,
  // these returned Infinity or a farther segment instead of the roadway 4.3-4.6 m away.
  const cases = [
    [3263.83, -484.92, 4.5961],
    [3263.83, -484.19, 4.5523],
    [3263.83, -483.46, 4.5198],
    [3263.83, -482.73, 4.5463],
    [-2080.06, 2378.69, 4.3660],
    [-2080.08, 2377.09, 4.5741]
  ];
  for (const [x, z, expected] of cases) {
    const d = roadClearance(x, z);
    assert.ok(Number.isFinite(d), `expected finite roadClearance at (${x}, ${z}), got ${d}`);
    assert.ok(Math.abs(d - expected) < 0.01, `at (${x}, ${z}) expected ~${expected}, got ${d}`);
    assert.ok(d < 4.6, `at (${x}, ${z}) expected < 4.6 m (YARD_ROAD_KEEP), got ${d}`);
  }
});
