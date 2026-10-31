const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Where streets meet the mainline railway (docs/geodata.md underpasses and level crossings). OSM tags a street under a
// rail bridge tunnel=yes / layer=-1; the build keeps such railway underpasses at grade, so the street stays whole. Before
// 2026-10-28 they were dropped: Hetmańska had an 80 m gap under the Górczyn line (both carriageways and both tram
// tracks), and the trackbed ran across it.
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

let GEO;
let network;
let railLayout;
let infra;
let buildRoadNetwork;
test.before(async () => {
  ({ GEO } = await import('../js/geodata.js'));
  const config = await import('../js/city-config.js');
  ({ buildRoadNetwork } = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {} } },
    filename: 'road-network.js'
  }));
  network = buildRoadNetwork([], []);
  const tramInfraModule = loadModule(readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert()
    },
    globals: { Math, Object, Array, Set, Map, Number, Float32Array, Float64Array, console: { info() {}, warn() {} }, document: inert() },
    filename: 'tram-infra.js'
  });
  railLayout = tramInfraModule.layoutRailInfrastructure(network);
  infra = tramInfraModule.buildTramInfrastructure(inert(), network);
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

test('level crossings have barriers and St. Andrew warning signals on all railway crossings', () => {
  const { crossings, barriers, signals } = railLayout;
  assert.ok(crossings.length >= 5, `${crossings.length} crossing sites`);

  // Verify all 5 key street crossings have barriers and St. Andrew signals
  for (const street of ['Świętego Michała', 'Krańcowa', 'Bałtycka', 'Gdyńska', 'Wrzesińska']) {
    const site = crossings.find((c) => c.street === street);
    assert.ok(site, `crossing on ${street} present`);
    assert.ok(site.barriers.length >= 4, `${street} has at least 4 barrier units`);
    assert.ok(site.signals.length >= 4, `${street} has at least 4 warning signals`);
  }

  assert.equal(barriers.length, 28, '28 barrier units in total');
  assert.equal(signals.length, 28, '28 warning signals in total');

  for (const b of barriers) {
    assert.ok(b.armLen >= 3.5 && b.armLen <= 9.0, `arm length ${b.armLen.toFixed(2)} m`);
    assert.ok(Number.isFinite(b.armYaw), 'valid boom yaw');
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.y), 'valid barrier coordinate');
  }
  for (const s of signals) {
    assert.ok(Number.isFinite(s.yaw), 'valid signal yaw');
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.y), 'valid signal coordinate');
  }
});

test('railway barriers and signals preserve road clearance, rail structure gauge, and tram clearance', () => {
  const tramTracks = GEO.rail.filter((r) => r.kind === 'tram');
  const tramDist = (x, z) => {
    let best = Infinity;
    for (const r of tramTracks) {
      for (let k = 0; k + 3 < r.pts.length; k += 2) {
        const ax = r.pts[k];
        const az = r.pts[k + 1];
        const ex = r.pts[k + 2] - ax;
        const ez = r.pts[k + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
      }
    }
    return best;
  };

  for (const b of railLayout.barriers) {
    assert.ok(railLayout.roadDist(b.x, b.z) >= 0.15, `barrier at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) stands off asphalt`);
    assert.ok(railLayout.laneDist(b.x, b.z) >= 1.85, `barrier at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) keeps clear of car lanes`);
    assert.ok(railLayout.railDist(b.x, b.z) >= 2.6, `barrier at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) satisfies rail structure gauge`);
    assert.ok(tramDist(b.x, b.z) >= 3.0, `barrier at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) keeps clear of tram tracks`);
  }

  for (const s of railLayout.signals) {
    assert.ok(railLayout.roadDist(s.x, s.z) >= 0.15, `signal at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) stands off asphalt`);
    assert.ok(railLayout.laneDist(s.x, s.z) >= 1.85, `signal at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) keeps clear of car lanes`);
    assert.ok(railLayout.railDist(s.x, s.z) >= 2.6, `signal at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) satisfies rail structure gauge`);
    assert.ok(tramDist(s.x, s.z) >= 3.0, `signal at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) keeps clear of tram tracks`);
  }
});

test('barrier cabinet and signal mast colliders are generated and keep off vehicle lanes', () => {
  const { colliders } = infra;

  for (const b of railLayout.barriers) {
    const c = colliders.find((col) => Math.hypot((col.minX + col.maxX) / 2 - b.x, (col.minZ + col.maxZ) / 2 - b.z) < 0.05);
    assert.ok(c, `collider found for barrier cabinet at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
    assert.ok(c.maxY >= b.y + 1.1, 'barrier cabinet collider has protective height');
    assert.ok(railLayout.laneDist((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) >= 1.85, 'barrier collider keeps off car lanes');
  }

  for (const s of railLayout.signals) {
    const c = colliders.find((col) => Math.hypot((col.minX + col.maxX) / 2 - s.x, (col.minZ + col.maxZ) / 2 - s.z) < 0.05);
    assert.ok(c, `collider found for signal mast at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
    assert.ok(c.maxY >= s.y + 2.5, 'signal mast collider reaches signal head height');
    assert.ok(railLayout.laneDist((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) >= 1.85, 'signal collider keeps off car lanes');
  }
});

test('barrier and signal footprints do not impede vehicular or tram traffic flow', () => {
  const km = (net) => net.edges.reduce((sum, e) => sum + e.span, 0) / 1000;
  const netWithFootprints = buildRoadNetwork([], [...railLayout.footprints]);
  assert.equal(netWithFootprints.edges.length, network.edges.length, 'edge count preserved with barrier footprints');
  assert.equal(km(netWithFootprints).toFixed(3), km(network).toFixed(3), 'roadway kilometers preserved');

  // Verify drivability across level crossings with barriers and signals placed
  const smSouth = nodeNear(2155, -920);
  const smNorth = nodeNear(2155, -780);
  assert.ok(drivable('Świętego Michała', smSouth.node, smNorth.node), 'Świętego Michała drivable northbound');
  assert.ok(drivable('Świętego Michała', smNorth.node, smSouth.node), 'Świętego Michała drivable southbound');

  const krSouth = nodeNear(2873, -1280);
  const krNorth = nodeNear(2873, -1160);
  assert.ok(drivable('Krańcowa', krSouth.node, krNorth.node), 'Krańcowa drivable northbound');
  assert.ok(drivable('Krańcowa', krNorth.node, krSouth.node), 'Krańcowa drivable southbound');

  assert.ok(drivable('Bałtycka', 2140, 2142), 'Bałtycka eastbound carriageway drivable across tracks');
  assert.ok(drivable('Bałtycka', 2134, 3810), 'Bałtycka westbound carriageway drivable across tracks');

  assert.ok(drivable('Gdyńska', 2131, 2132), 'Gdyńska northbound carriageway drivable across tracks');
  assert.ok(drivable('Gdyńska', 4739, 4903), 'Gdyńska southbound carriageway drivable across tracks');

  const wrWest = nodeNear(3580, -1125);
  const wrEast = nodeNear(3690, -1090);
  assert.ok(drivable('Wrzesińska', wrWest.node, wrEast.node), 'Wrzesińska drivable eastbound');
  assert.ok(drivable('Wrzesińska', wrEast.node, wrWest.node), 'Wrzesińska drivable westbound');
});
