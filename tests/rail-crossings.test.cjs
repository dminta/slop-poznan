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

test('railway crossings on key streets (Św. Michała, Krańcowa, Bałtycka, Gdyńska, Wrzesińska) are elevated viaducts without level barriers or flush tracks', () => {
  const { viaducts, barriers, signals, level } = railLayout;

  // Barriers and warning signals have been liquidated, flush ground rail tracks eliminated
  assert.equal(barriers.length, 0, 'zero level crossing barrier units');
  assert.equal(signals.length, 0, 'zero level crossing warning signals');
  assert.equal(level.length, 0, 'zero flush rail pieces on roadways');

  // Verify all 5 key street crossings have elevated viaduct spans with vertical clearance >= 4.8 m
  const sites = [
    { name: 'Świętego Michała', x: 2155, z: -850, minViaducts: 4 },
    { name: 'Krańcowa', x: 2873, z: -1222, minViaducts: 4 },
    { name: 'Bałtycka', x: 3088, z: -1976, minViaducts: 2 },
    { name: 'Gdyńska', x: 3028, z: -2090, minViaducts: 2 },
    { name: 'Wrzesińska', x: 3636, z: -1108, minViaducts: 2 }
  ];

  for (const s of sites) {
    const vNear = viaducts.filter((v) => Math.hypot(v.mx - s.x, v.mz - s.z) < 80);
    assert.ok(vNear.length >= s.minViaducts, `${s.name} has ${vNear.length} elevated viaduct spans (expected >= ${s.minViaducts})`);
    for (const v of vNear) {
      assert.ok(v.yClearance >= 4.8, `${s.name} viaduct vertical clearance ${v.yClearance} m >= 4.8 m`);
      assert.ok(v.deckY >= 5.14, `${s.name} viaduct deck height ${v.deckY} m >= 5.14 m`);
      assert.ok(v.spanLen >= 10 && v.spanLen <= 120, `${s.name} valid viaduct span length ${v.spanLen.toFixed(1)} m`);
    }
  }
});

test('viaduct deck structures preserve vertical clearance and keep car lanes unobstructed', () => {
  const sites = [
    { name: 'Świętego Michała', x: 2155, z: -850 },
    { name: 'Krańcowa', x: 2873, z: -1222 },
    { name: 'Bałtycka', x: 3088, z: -1976 },
    { name: 'Gdyńska', x: 3028, z: -2090 },
    { name: 'Wrzesińska', x: 3636, z: -1108 }
  ];

  for (const s of sites) {
    const vNear = railLayout.viaducts.filter((v) => Math.hypot(v.mx - s.x, v.mz - s.z) < 80);
    for (const v of vNear) {
      assert.ok(v.pieces.some((p) => railLayout.roadDist(p.ax, p.az) <= 4.0 || railLayout.roadDist(p.bx, p.bz) <= 4.0),
        `viaduct at (${v.mx.toFixed(1)}, ${v.mz.toFixed(1)}) bridges across the roadway cut`);
    }
  }

  // Abutment end walls stand at the ramp ends and keep clear of vehicle lanes
  for (const e of railLayout.ends) {
    if (e.viaduct) {
      assert.ok(railLayout.laneDist(e.x, e.z) >= 1.75, `viaduct abutment at (${e.x.toFixed(1)}, ${e.z.toFixed(1)}) keeps clear of car lanes`);
    }
  }
});

test('viaduct colliders are elevated overhead leaving ground roadway lanes 100% clear', () => {
  const { colliders } = infra;

  // Viaduct deck colliders have bottom clearance >= 4.8 m
  const overhead = colliders.filter((c) => (c.minY ?? 0) >= 4.8);
  assert.ok(overhead.length >= 80, `at least 80 overhead viaduct colliders (found ${overhead.length})`);

  // Ground lanes across the 5 crossing sites are not blocked by the corridor keep-out raster
  const sites = [
    { name: 'Świętego Michała', x: 2155, z: -850 },
    { name: 'Krańcowa', x: 2873, z: -1222 },
    { name: 'Bałtycka', x: 3088, z: -1976 },
    { name: 'Gdyńska', x: 3028, z: -2090 },
    { name: 'Wrzesińska', x: 3636, z: -1108 }
  ];

  for (const s of sites) {
    const nearEdges = network.edges.filter((e) => {
      const mx = e.x0 + (e.dx * e.span) / 2;
      const mz = e.z0 + (e.dz * e.span) / 2;
      return Math.hypot(mx - s.x, mz - s.z) < 60;
    });
    let blockedCells = 0;
    for (const e of nearEdges) {
      for (const o of e.lanes) {
        for (let st = 0; st <= e.span; st += 1.0) {
          const x = e.x0 + e.dx * st + e.rx * o;
          const z = e.z0 + e.dz * st + e.rz * o;
          if (railLayout.corridor.has(x, z)) blockedCells++;
        }
      }
    }
    assert.equal(blockedCells, 0, `${s.name} road lanes have 0 blocked corridor cells`);
  }
});

test('vehicular traffic flows continuously across all 5 former crossing sites', () => {
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
