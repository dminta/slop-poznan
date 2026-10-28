const assert = require('node:assert/strict');
const test = require('node:test');

// Where streets meet the mainline railway (docs/geodata.md underpasses and level crossings). OSM tags a street under a
// rail bridge tunnel=yes / layer=-1; the build keeps such railway underpasses at grade, so the street stays whole. Before
// 2026-10-28 they were dropped: Hetmańska had an 80 m gap under the Górczyn line (both carriageways and both tram
// tracks), and the trackbed ran across it.
let GEO;
test.before(async () => {
  ({ GEO } = await import('../js/geodata.js'));
});

// Nearest road-graph node to (x, z)
function nodeNear(x, z) {
  const n = GEO.roadGraph.nodes;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n.length; i += 2) {
    const d = Math.hypot(n[i] - x, n[i + 1] - z);
    if (d < bestD) {
      bestD = d;
      best = i / 2;
    }
  }
  return { node: best, d: bestD };
}

// Can traffic drive from one node to the other on links of this name alone (link direction respected)?
function drivable(name, from, to) {
  const { links, names } = GEO.roadGraph;
  const out = new Map();
  const add = (a, b) => {
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  };
  for (const [a, b, ni, , , dir] of links) {
    if (names[ni] !== name) continue;
    if (dir >= 0) add(a, b);
    if (dir <= 0) add(b, a);
  }
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const a = queue.shift();
    if (a === to) return true;
    for (const b of out.get(a) || []) {
      if (!seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return false;
}

test('Hetmańska runs on under the Górczyn railway bridge in both directions', () => {
  // the carriageways' ends either side of the bridge (between Górecka and Fabryczna)
  const eastFrom = nodeNear(-2058, 2437);
  const eastTo = nodeNear(-1523, 2517);
  const westFrom = nodeNear(-1700, 2486);
  const westTo = nodeNear(-1954, 2444);
  for (const n of [eastFrom, eastTo, westFrom, westTo]) assert.ok(n.d < 2, `a node within ${n.d.toFixed(1)} m`);
  assert.ok(drivable('Hetmańska', eastFrom.node, eastTo.node), 'eastbound Hetmańska is continuous');
  assert.ok(drivable('Hetmańska', westFrom.node, westTo.node), 'westbound Hetmańska is continuous');
  // ...and its tram tracks, which OSM maps in the same underpass
  const trackAt = (x, z) => GEO.rail.some((r) => {
    if (r.kind !== 'tram') return false;
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const ax = r.pts[k];
      const az = r.pts[k + 1];
      const ex = r.pts[k + 2] - ax;
      const ez = r.pts[k + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(ax + ex * t - x, az + ez * t - z) < 3) return true;
    }
    return false;
  });
  for (let x = -1875; x <= -1805; x += 10) assert.ok(trackAt(x, 2479 + ((x + 1879) * 16) / 80), `tram track under the bridge at x ${x}`);
  // a GEO.roads polyline carries the street through for the map
  const roadAt = (x, z) => GEO.roads.some(([name, , , , , p]) => {
    if (name !== 'Hetmańska') return false;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ex = p[k + 2] - p[k];
      const ez = p[k + 3] - p[k + 1];
      const t = Math.max(0, Math.min(1, ((x - p[k]) * ex + (z - p[k + 1]) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(p[k] + ex * t - x, p[k + 1] + ez * t - z) < 2) return true;
    }
    return false;
  });
  assert.ok(roadAt(-1853, 2493) && roadAt(-1856, 2466), 'GEO.roads has both carriageways under the bridge');
});

test('level crossings are the nodes streets share with the mainline railway', () => {
  const lx = GEO.levelCrossings;
  assert.ok(Array.isArray(lx) && lx.length % 2 === 0);
  assert.ok(lx.length / 2 >= 20 && lx.length / 2 <= 80, `${lx.length / 2} level crossings`);
  const [x0, x1, z0, z1] = GEO.frame.detailBox;
  for (let k = 0; k < lx.length; k += 2) {
    assert.ok(lx[k] >= x0 && lx[k] <= x1 && lx[k + 1] >= z0 && lx[k + 1] <= z1, 'inside the detail box');
    assert.ok(Math.hypot(lx[k] + 1855, lx[k + 1] - 2482) > 200, 'Hetmańska passes under the railway, not across it');
  }
  // the real ones: Św. Michała, Krańcowa, Bałtycka, Gdyńska and Wrzesińska in the east
  const near = (x, z) => {
    for (let k = 0; k < lx.length; k += 2) if (Math.hypot(lx[k] - x, lx[k + 1] - z) < 15) return true;
    return false;
  };
  for (const [x, z, name] of [[2155, -850, 'Św. Michała'], [2873, -1222, 'Krańcowa'], [3088, -1976, 'Bałtycka'],
    [3028, -2090, 'Gdyńska'], [3636, -1108, 'Wrzesińska']]) assert.ok(near(x, z), `level crossing on ${name}`);
});
