const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const CROSSWALK = 4.3;
const STOP_SETBACK = 1.75;
const CROSSWALK_REACH = 4;
const { createPedestrianRoutes } = loadModule(
  readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8'),
  { imports: { './road-network.js': { CROSSWALK, CROSSWALK_REACH } } }
);

// A two-way road leaving node n along (ux, uz), as road-network.js leaves it: straight edges between stop lines `back`
// metres out from n, a right normal (rx, rz) = (-dz, dx) and the lateral axis (clx, clz) flipped the same both ways.
function edge(x0, z0, dx, dz, back, len, half) {
  const rx = -dz, rz = dx, flip = rx < -1e-6 || (Math.abs(rx) <= 1e-6 && rz < 0);
  return { x0, z0, sx: x0 + dx * back, sz: z0 + dz * back, dx, dz, rx, rz, len, span: len + 2 * back, setbackFrom: STOP_SETBACK,
    setbackTo: STOP_SETBACK, half, clx: flip ? -rx : rx, clz: flip ? -rz : rz };
}
function arm(n, ux, uz, { half, back, side, group, len = 80 }) {
  const out = edge(n.x, n.z, ux, uz, back, len, half);
  const far = { x: n.x + ux * (len + 2 * back), z: n.z + uz * (len + 2 * back) };
  const inn = edge(far.x, far.z, -ux, -uz, back, len, half);
  const a = { ux, uz, side, group, half, in: inn, out };
  out.outArm = a;
  inn.inArm = a;
  return a;
}

// Everywhere off the roads through n (each `wider` metres wider than its lanes' half width says) is one curb island
function routesAround(n, wider = 0) {
  const off = (x, z) => n.arms.every((a) => Math.abs((x - n.x) * a.uz - (z - n.z) * a.ux) > a.half + wider - 0.01
    || (x - n.x) * a.ux + (z - n.z) * a.uz < 0);
  const block = { poly: [] };
  const edges = n.arms.flatMap((a) => [a.in, a.out]);
  return createPedestrianRoutes({ nodes: [n], edges, walkable: () => true }, (x, z) => (off(x, z) ? block : null));
}
// The zebra of a crosswalk as a rectangle: its corners
const corners = (c, h = (CROSSWALK - 0.3) / 2) => [[c.ax, c.az], [c.bx, c.bz]].flatMap(([x, z]) => [[x - c.ux * h, z - c.uz * h], [x + c.ux * h, z + c.uz * h]]);
function overlap(p, q) {
  const P = corners(p), Q = corners(q);
  for (const [ax, az] of [[p.ux, p.uz], [-p.uz, p.ux], [q.ux, q.uz], [-q.uz, q.ux]]) {
    const pd = P.map(([x, z]) => x * ax + z * az), qd = Q.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pd) <= Math.min(...qd) + 1e-9 || Math.max(...qd) <= Math.min(...pd) + 1e-9) return false;
  }
  return true;
}

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('a centreline junction gets oriented crosswalks over every arm, at the painted crosswalks', () => {
  const n = { x: 40, z: -25, signal: false, arms: [] };
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
      near(mx * a.ux + mz * a.uz, 12 - STOP_SETBACK - CROSSWALK / 2 + t.line, 'between the junction and its stop lines');
      near(mx * a.uz - mz * a.ux, 0, 'centred on its road');
    }
  }
  assert.deepEqual(tracks.filter((t) => t.side === 6).map((t) => t.line).sort(), [-0.75, 0.75]);
});

test('no crosswalks where a street merely bends', () => {
  const bend = { x: 0, z: 0, shape: true, signal: false, arms: [] };
  bend.arms.push(arm(bend, 1, 0, { half: 5, back: 2, side: 4, group: 0 }), arm(bend, -0.96, 0.28, { half: 5, back: 2, side: 5, group: 0 }));
  assert.equal(routesAround(bend).across(bend).length, 0);
});

test('zebras run on to the real curb within CROSSWALK_REACH, and there is none where they would end in the roadway', () => {
  const junction = () => {
    const n = { x: 0, z: 0, signal: false, arms: [] };
    for (const [ux, uz, side, group] of [[1, 0, 0, 0], [-1, 0, 1, 0], [0, 1, 2, 1], [0, -1, 3, 1]]) {
      n.arms.push(arm(n, ux, uz, { half: 5, back: 16, side, group }));
    }
    return n;
  };
  const n = junction();
  const near = routesAround(n, 3);
  assert.equal(near.crosswalks.length, 4);
  for (const c of near.crosswalks) {
    assert.ok(Math.abs(Math.hypot(c.bx - c.ax, c.bz - c.az) - 16) < 0.26, 'curb to curb, 3 m past each modelled curb');
    for (const t of near.across(n).filter((t) => t.side === c.side)) assert.ok(Math.abs(t.len - 20) < 0.6, '2 m onto each sidewalk');
  }
  const far = junction();
  assert.equal(routesAround(far, CROSSWALK_REACH + 1).crosswalks.length, 0, 'no zebra ending in the roadway');
  assert.equal(routesAround(far, CROSSWALK_REACH + 1).across(far).length, 0, 'and nobody crosses there');
});

test('where the zebras of a junction complex overlap, those of the longer roads stay', () => {
  // A corridor along x with sidewalks north and south of it (|z| > 4), two junctions 10 m apart on it: each has a long
  // outer arm and a short inner one, and the two inner zebras (2.15-6.15 and 3.85-7.85 m) overlap
  const n1 = { x: 0, z: 0, signal: false, arms: [] };
  const n2 = { x: 10, z: 0, signal: false, arms: [] };
  n1.arms.push(arm(n1, -1, 0, { half: 4, back: 8, side: 0, group: 0, len: 120 }));
  n1.arms.push(arm(n1, 1, 0, { half: 4, back: 8, side: 1, group: 0, len: 0.5 }));
  n2.arms.push(arm(n2, -1, 0, { half: 4, back: 8, side: 0, group: 0, len: 2 }));
  n2.arms.push(arm(n2, 1, 0, { half: 4, back: 8, side: 1, group: 0, len: 120 }));
  const block = { poly: [] };
  const edges = [n1, n2].flatMap((n) => n.arms.flatMap((a) => [a.in, a.out]));
  const routes = createPedestrianRoutes({ nodes: [n1, n2], edges, walkable: () => true }, (x, z) => (Math.abs(z) > 4 ? block : null));
  const kept = Array.from(routes.crosswalks, (c) => `${c.node === n1 ? 'n1' : 'n2'}:${c.side}`).sort();
  assert.deepEqual(kept, ['n1:0', 'n2:0', 'n2:1'], 'both outer arms, and of the inner ones the longer link\'s');
  for (const p of routes.crosswalks) for (const q of routes.crosswalks) assert.ok(p === q || !overlap(p, q), 'no zebras overlap');
  assert.deepEqual(Array.from(routes.across(n1), (t) => t.side), [0], 'nobody crosses where no zebra is');
  assert.deepEqual(Array.from(routes.across(n2), (t) => t.side).sort(), [0, 1]);
});

// A divided road along z: two roadways 4 m half wide at x = -gap/2 - 4 and x = gap/2 + 4, the strip between them no
// curb island, each roadway's node with a side street leaving it west / east; the sidewalks are off all the roads
function dividedRoad(gap, railClearance = null) {
  const off = gap / 2 + 4;
  const n1 = { x: -off, z: 0, signal: false, arms: [] };
  const n2 = { x: off, z: 0, signal: false, arms: [] };
  n1.arms.push(arm(n1, 0, 1, { half: 4, back: 12, side: 0, group: 0 }), arm(n1, -1, 0, { half: 4, back: 12, side: 1, group: 1 }));
  n2.arms.push(arm(n2, 0, 1, { half: 4, back: 12, side: 0, group: 0 }), arm(n2, 1, 0, { half: 4, back: 12, side: 1, group: 1 }));
  const block = { poly: [] };
  const edges = [n1, n2].flatMap((n) => n.arms.flatMap((a) => [a.in, a.out]));
  const routes = createPedestrianRoutes({ nodes: [n1, n2], edges, walkable: () => true },
    (x, z) => (Math.abs(x) > off + 4 && Math.abs(z) > 4 ? block : null), railClearance);
  return { n1, n2, routes };
}

// Tram tracks along z down the strip at the given x (distance to the nearest, capped at r)
const tracksAt = (...xs) => (x, z, r) => Math.min(r, ...xs.map((t) => Math.abs(x - t)));

test('on a tram strip people wait only where the rails leave room, and cross on in one go from the other end', () => {
  // an 8 m strip (x -4 to 4) with one track 1 m off its east curb: the east end has no room to wait
  const { n1, n2, routes } = dividedRoad(8, tracksAt(3));
  const [a] = routes.across(n1).filter((t) => t.side === 0 && t.line > 0);
  const b = routes.across(n2).filter((t) => t.side === 0);
  assert.ok(a && b.length, 'still a split crossing');
  for (const t of b) assert.deepEqual(Array.from(t.cramped), [true, false], 'nobody waits at the east end');
  // westbound walkers wait at the west end (2.4 m from the track) for the east roadway's crosswalk, then cross on
  const path = routes.next(a, 1, 100, 20);
  assert.ok(b.includes(path[0].hold), 'the walk over the strip holds for the east crosswalk');
  assert.ok(path[0].track.len > 4, 'one walk per line, over the strip');
  // and the walk back from the east end needs no hold: the west end has room
  const back = routes.next(b[0], -1, -100, 20);
  assert.equal(back[0].hold, undefined);
  // with a second track 1 m off the west curb neither end has room: no split crossing
  const both = dividedRoad(8, tracksAt(3, -3));
  assert.equal(both.routes.crosswalks.filter((c) => c.side === 0).length, 0);
});

test('a divided road whose strip is no curb island gets a split crossing, one zebra over each roadway', () => {
  const { n1, n2, routes } = dividedRoad(8);
  const over = (n) => routes.crosswalks.find((c) => c.node === n && c.side === 0);
  const west = over(n1), east = over(n2);
  assert.ok(west && east, 'a zebra over each roadway');
  near(Math.max(west.ax, west.bx), -4, 'the west zebra stops at its curb by the strip');
  near(Math.min(east.ax, east.bx), 4, 'and so does the east one');
  const [a] = routes.across(n1).filter((t) => t.side === 0);
  const [b] = routes.across(n2).filter((t) => t.side === 0);
  near(a.ax + a.ux * a.len, -4 + 1.6, 'the walk lands 1.6 m onto the strip');
  // from the west sidewalk over the west roadway, then over the strip onto the east roadway's crosswalk
  const path = routes.next(a, 1, 100, 20);
  assert.equal(path[path.length - 1].track, b);
  assert.equal(path[path.length - 1].dir, 1);
  near(path[0].track.len, 8 - 3.2, 'the walk over the strip');
  const back = routes.next(b, -1, -100, 20);
  assert.equal(back[back.length - 1].track, a, 'and back');
  assert.equal(back[back.length - 1].dir, -1);
});

test('no split crossing over a strip too narrow to wait on', () => {
  const { n1, n2, routes } = dividedRoad(3);
  assert.equal(routes.crosswalks.filter((c) => c.side === 0).length, 0);
  assert.equal(routes.across(n1).filter((t) => t.side === 0).length + routes.across(n2).filter((t) => t.side === 0).length, 0);
});
