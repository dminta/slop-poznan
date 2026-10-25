const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const CROSSWALK = 2.5;
const { createPedestrianRoutes } = loadModule(
  readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8'),
  { imports: { './road-network.js': { CROSSWALK } } }
);

// A two-way road leaving node n along (ux, uz), as road-network.js leaves it: straight edges between stop lines `back`
// metres out from n, a right normal (rx, rz) = (-dz, dx) and the lateral axis (clx, clz) flipped the same both ways.
function edge(x0, z0, dx, dz, back, len, half) {
  const rx = -dz, rz = dx, flip = rx < -1e-6 || (Math.abs(rx) <= 1e-6 && rz < 0);
  return { sx: x0 + dx * back, sz: z0 + dz * back, dx, dz, rx, rz, len, half, clx: flip ? -rx : rx, clz: flip ? -rz : rz };
}
function arm(n, ux, uz, { half, back, side, group }) {
  const len = 80;
  const out = edge(n.x, n.z, ux, uz, back, len, half);
  const far = { x: n.x + ux * (len + 2 * back), z: n.z + uz * (len + 2 * back) };
  const inn = edge(far.x, far.z, -ux, -uz, back, len, half);
  const a = { ux, uz, side, group, half, in: inn, out };
  out.outArm = a;
  inn.inArm = a;
  return a;
}

// Everywhere off the roads through n is one curb island
function routesAround(n) {
  const off = (x, z) => n.arms.every((a) => Math.abs((x - n.x) * a.uz - (z - n.z) * a.ux) > a.half
    || (x - n.x) * a.ux + (z - n.z) * a.uz < 0);
  const block = { poly: [] };
  return createPedestrianRoutes({ walkable: () => true, onSidewalk: off }, (x, z) => (off(x, z) ? block : null));
}

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('a centreline junction gets oriented crosswalks over every arm, at the painted crosswalks', () => {
  const n = { x: 40, z: -25, general: true, signal: false, arms: [] };
  const deg = Math.PI / 180;
  const arms = [[30, 7, 4, 0], [210, 7, 5, 0], [120, 4.5, 6, 1], [300, 4.5, 7, 1]];
  for (const [angle, half, side, group] of arms) {
    n.arms.push(arm(n, Math.cos(angle * deg), Math.sin(angle * deg), { half, back: 12, side, group }));
  }
  const tracks = Array.from(routesAround(n).across(n));
  for (const a of n.arms) {
    const mine = tracks.filter((t) => t.side === a.side);
    assert.equal(mine.length, a.group === 0 ? 1 : 2, `lines over side ${a.side}`);
    for (const t of mine) {
      assert.equal(t.node, n);
      assert.equal(t.from, n);
      assert.equal(t.to, n);
      assert.equal(t.group, a.group, 'walks on its road group\'s phase, not by side index');
      near(t.ux * a.ux + t.uz * a.uz, 0, 'square to its arm');
      near(t.ux, a.in.clx, 'along the axis traffic measures lanes on (x)');
      near(t.uz, a.in.clz, 'along the axis traffic measures lanes on (z)');
      near(t.len, 2 * a.half + 4, 'curb to curb and 2 m onto each sidewalk');
      const mx = t.ax + t.ux * t.len / 2 - n.x, mz = t.az + t.uz * t.len / 2 - n.z;
      near(mx * a.ux + mz * a.uz, 12 - CROSSWALK / 2 + t.line, 'between the junction and its stop lines');
      near(mx * a.uz - mz * a.ux, 0, 'centred on its road');
    }
  }
  assert.deepEqual(tracks.filter((t) => t.side === 6).map((t) => t.line).sort(), [-0.75, 0.75]);
});

test('grid intersection crosswalks stay at the box edge, one line over the avenue and two over the street', () => {
  const n = { x: 100, z: 200, hx: 9, hz: 5, general: false, signal: true, arms: [] };
  const ave = { half: 9, group: 0 }, st = { half: 5, group: 1 };
  n.arms.push(arm(n, 1, 0, { ...st, side: 0, back: n.hx + CROSSWALK }), arm(n, -1, 0, { ...st, side: 1, back: n.hx + CROSSWALK }),
    arm(n, 0, 1, { ...ave, side: 2, back: n.hz + CROSSWALK }), arm(n, 0, -1, { ...ave, side: 3, back: n.hz + CROSSWALK }));
  const got = Array.from(routesAround(n).across(n), (t) => [t.side, t.ax, t.az, t.ux, t.uz, t.len].map((v) => Math.round(v * 1e6) / 1e6));
  got.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  // the avenue's crosswalks run +x at z = n.z +- (hz + 1.25 + 0.75), the street's run +z at x = n.x +- (hx + 1.25) +- 0.75
  assert.deepEqual(got, [
    [0, 109.5, 193, 0, 1, 14], [0, 111, 193, 0, 1, 14],
    [1, 89, 193, 0, 1, 14], [1, 90.5, 193, 0, 1, 14],
    [2, 89, 207, 1, 0, 22], [3, 89, 193, 1, 0, 22]
  ]);
});

test('no crosswalks at unsignalised grid corners or where a street merely bends', () => {
  const corner = { x: 0, z: 0, hx: 6, hz: 5, general: false, signal: false, arms: [] };
  corner.arms.push(arm(corner, 1, 0, { half: 5, back: 8.5, side: 0, group: 1 }), arm(corner, 0, 1, { half: 6, back: 7.5, side: 2, group: 0 }));
  assert.equal(routesAround(corner).across(corner).length, 0);
  const bend = { x: 0, z: 0, general: true, shape: true, signal: false, arms: [] };
  bend.arms.push(arm(bend, 1, 0, { half: 5, back: 2, side: 4, group: 0 }), arm(bend, -0.96, 0.28, { half: 5, back: 2, side: 5, group: 0 }));
  assert.equal(routesAround(bend).across(bend).length, 0);
});
