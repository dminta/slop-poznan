const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');

// The network comes from GEO.roadGraph alone
function buildPureGraph(roadGraph) {
  const config = { BLOCKS: [], SIGNAL_SITES: [], isLand: () => true };
  const { buildRoadNetwork } = loadModule(source, {
    imports: { './city-config.js': config, './geodata.js': { GEO: { roadGraph } } },
    globals: { console: { info() {} } },
    filename: 'road-network.js'
  });
  return buildRoadNetwork([], []);
}

test('compound crossing reservations follow connector arc length and preserve the tail on its outgoing edge', () => {
  const { configureCompoundCrossings } = loadModule(source, {
    imports: { './city-config.js': {}, './geodata.js': { GEO: {} } }
  });
  const outgoing = {};
  const incoming = { lanes: [0], setbackTo: 1.75, moves: [{ out: [0], to: outgoing }] };
  const node = { arms: [{ side: 0, in: incoming }, { side: 3, out: outgoing }] };
  const curve = { len: 30 };
  const network = {
    connector: () => curve,
    curvePoint: (_curve, s, out) => Object.assign(out, { x: s / 2, z: s * Math.sqrt(3) / 2 })
  };
  const crossing = {
    node, side: 3, ax: 0, az: 10, bx: 20, bz: 10, h: 2,
    tracks: [{ sides: [{ side: 3 }, { side: 0 }] }]
  };
  configureCompoundCrossings(network, [crossing]);
  // The centre leaves the expanded paint near arc 15.9 m, although its incoming-axis projection is only 7.9 m.
  assert.ok(curve.crosswalkEnd >= 15.8 && curve.crosswalkEnd <= 16.5);
  assert.equal(incoming.crosswalkEnd, curve.crosswalkEnd);
  assert.equal(outgoing.crosswalkTails.length, 1);
  assert.equal(outgoing.crosswalkTails[0].node, node);
  assert.equal(outgoing.crosswalkTails[0].side, 0);
  assert.equal(outgoing.crosswalkTails[0].end, curve.crosswalkEnd - curve.len);
  configureCompoundCrossings(network, [crossing]);
  assert.equal(outgoing.crosswalkTails.length, 1, 'repeated layout does not duplicate the tail reservation');

  const ordinary = { ...crossing, tracks: [{ sides: null }] };
  const untouched = { len: 30 };
  configureCompoundCrossings({ ...network, connector: () => untouched }, [ordinary]);
  assert.equal(untouched.crosswalkEnd, undefined, 'ordinary zebra reservations retain their existing path');
});

// Three east-west roads over four north-south ones, 120 m apart. Links: [a, b, nameIdx, w, lanes, dir, inner]
function syntheticGraph() {
  const nodes = [];
  for (const z of [0, 120, 240]) for (const x of [0, 120, 240, 360]) nodes.push(x, z);
  const id = (col, row) => row * 4 + col;
  const names = ['MAIN ST', 'SIDE ST', 'GAP ST', 'CROSS ST'];
  const links = [];
  // MAIN ST: 18 m except one 10 m stretch (major over 2/3 of its length); SIDE ST: 9 m, a lane each way; GAP ST: no
  // width on its first link, 16 m on the others
  [[18, 18, 10], [9, 9, 9], [0, 16, 16]].forEach((widths, row) => {
    widths.forEach((w, col) => links.push([id(col, row), id(col + 1, row), row, w, 2, 0, []]));
  });
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 2; row++) links.push([id(col, row), id(col, row + 1), 3, 9, 2, 0, []]);
  }
  return { nodes, links, names };
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const along = (net, z) => net.edges.filter((e) => near(e.dz, 0) && near(e.z0, z));

test('the road network builds from the centreline graph', () => {
  const net = buildPureGraph(syntheticGraph());
  assert.equal(net.nodes.length, 12);
  assert.equal(net.edges.length, 34); // 17 two-way links
  assert.ok(net.nodes.every((n) => n.sideCount === n.arms.length && n.sideCount >= 2 && n.groupCount >= 2));
  assert.ok(net.edges.every((e) => e.lanes.length && e.inArm && e.outArm));
});

// Three east-west roads over three north-south ones at x = 0, L and L + 120, 9 m roads all round
function ladder(L) {
  const nodes = [];
  for (const z of [0, 120, 240]) for (const x of [0, L, L + 120]) nodes.push(x, z);
  const links = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) links.push([r * 3 + c, r * 3 + c + 1, 0, 9, 2, 0, []]);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) links.push([r * 3 + c, (r + 1) * 3 + c, 1, 9, 2, 0, []]);
  return { nodes, links, names: ['EAST ST', 'NORTH ST'] };
}

test('stop lines stand STOP_SETBACK behind the crosswalk band, giving it up first on short links', () => {
  const { STOP_SETBACK, CROSSWALK } = loadModule(source, {
    imports: { './city-config.js': {}, './geodata.js': { GEO: {} } }, filename: 'road-network.js'
  });
  const link = (L) => {
    const net = buildPureGraph(ladder(L));
    return net.edges.find((e) => near(e.dx, 1) && near(e.x0, 0) && near(e.z0, 120));
  };
  const long = link(100);
  assert.ok(near(long.setbackFrom, STOP_SETBACK) && near(long.setbackTo, STOP_SETBACK));
  const back = (long.sx - long.x0) * long.dx; // past the crossing road's half width, the crosswalk and the setback
  assert.ok(back > 4.5 + CROSSWALK + STOP_SETBACK - 1e-6, `${back.toFixed(2)} m from the junction centre to the stop line`);
  // 30 m: the stop lines close up to the zebras to leave 10 m to queue on, and the zebras stay put
  const short = link(30);
  assert.ok(near(short.len, 10) && !short.squeezed);
  assert.ok(short.setbackTo > 0 && short.setbackTo < STOP_SETBACK && near(short.setbackFrom, short.setbackTo));
  assert.ok(near((short.sx - short.x0) * short.dx - short.setbackFrom, back - STOP_SETBACK), 'the zebra where it was');
  // 22 m: no setback left, and the stop lines pull in on the crossing roads
  const shorter = link(22);
  assert.ok(near(shorter.len, 10) && shorter.squeezed && near(shorter.setbackTo, 0));
});

test('major roads come from width and lanes, over most of a named road', () => {
  const net = buildPureGraph(syntheticGraph());
  const main = along(net, 0);
  assert.equal(main.length, 6);
  assert.ok(main.every((e) => e.major && e.axis === 'ave'), 'the 10 m stretch of a mostly 18 m road stays major');
  const side = along(net, 120);
  assert.equal(side.length, 6);
  assert.ok(side.every((e) => !e.major && e.axis === 'st'));
  assert.ok(net.edges.filter((e) => near(e.dx, 0)).every((e) => !e.major));
  const gap = along(net, 240);
  assert.ok(gap.every((e) => e.major));
  const unmeasured = gap.filter((e) => Math.min(e.x0, e.x0 + e.dx * e.span) < 1);
  assert.equal(unmeasured.length, 2);
  assert.ok(unmeasured.every((e) => e.half === 8), 'a link with no width takes its road\'s median width');
});

test('edges carry their link\'s speed limit, 50 km/h where it has none', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l.push(0, 30); // SIDE ST: a 30 zone (flags 0, 30 km/h)
  const net = buildPureGraph(graph);
  assert.ok(along(net, 120).every((e) => near(e.limit, 30 / 3.6)));
  assert.ok(along(net, 0).every((e) => near(e.limit, 50 / 3.6)));
});

test('three travel lanes make a narrow road major', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) if (l[2] === 1) l[4] = 3;
  assert.ok(along(buildPureGraph(graph), 120).every((e) => e.major));
});

test('lanes follow the OSM lane count and direction within the roadway', () => {
  const graph = syntheticGraph();
  for (const l of graph.links) {
    if (l[2] === 0) l[4] = 4; // MAIN ST: four lanes, two each way
    if (l[2] === 3) { l[3] = 3.4; l[4] = 1; } // CROSS ST: a two-way lane 3.4 m wide
  }
  const net = buildPureGraph(graph);
  const main = along(net, 0).filter((e) => e.half > 8);
  assert.ok(main.length && main.every((e) => e.lanes.length === 2 && near(e.lanes[0], 1.8) && near(e.lanes[1], 5.4)));
  const cross = net.edges.filter((e) => near(e.dx, 0));
  assert.equal(cross.length, 16);
  assert.ok(cross.every((e) => e.lanes.length === 1 && near(e.lanes[0], e.half / 2)), 'each way keeps to its half of a narrow road');
});

test('divided roadways keep their own lines into merged junctions, their lanes beside a tram strip', () => {
  // SIDE ST (z = 120) as two one-way roadways 12 m apart with the tram tracks between them: eastbound along z = 126,
  // westbound along z = 114, each 2 lanes in 13 m (6.5 m of it the tram strip, on its left: flags bit 4), joined to
  // the junctions at z = 120 by 6 m links, which merge them into one junction there
  const graph = syntheticGraph();
  graph.links = graph.links.filter((l) => l[2] !== 1);
  const at = (x, z) => (graph.nodes.push(x, z), graph.nodes.length / 2 - 1);
  for (let col = 0; col < 4; col++) {
    const mid = 4 + col;
    const s = at(col * 120, 126);
    const n = at(col * 120, 114);
    graph.links.push([mid, s, 1, 9, 2, 0, []], [mid, n, 1, 9, 2, 0, []]);
    graph.nodes.push(0, 0); // spare, keeps the indices below simple
    if (col > 0) {
      graph.links.push([s - 3, s, 1, 13, 2, 1, [], 2 | 16, 50]); // eastbound: tracks on its left (north)
      graph.links.push([n, n - 3, 1, 13, 2, 1, [], 2 | 16, 50]); // westbound: tracks on its left (south)
    }
  }
  const net = buildPureGraph(graph);
  const way = (sign) => net.edges.filter((e) => near(e.dz, 0) && Math.sign(e.dx) === sign && e.z0 > 100 && e.z0 < 140);
  const z = (e, o) => e.z0 + e.rz * o;
  for (const [sign, line] of [[1, 126], [-1, 114]]) {
    const edges = way(sign);
    assert.ok(edges.length >= 3, `${edges.length} edges ${sign > 0 ? 'east' : 'west'}`);
    for (const e of edges) {
      // the roadway (carriageway and strip) 3.25 m off the carriageway's line towards the tracks, and the lanes on the
      // carriageway, not moved onto one centreline with the other way (z = 120, over the tracks)
      assert.ok(Math.abs(e.z0 - (line - sign * 3.25)) < 1e-6, `roadway along z = ${e.z0}`);
      const lanes = e.lanes.map((o) => z(e, o).toFixed(1)).sort().join();
      assert.equal(lanes, [line - 1.8, line + 1.8].map((v) => v.toFixed(1)).join());
      assert.ok(near(e.half, 6.5));
    }
  }
});

// The real Poznań graph on the real land, bare and with the street furniture street-details.js stands along the curbs
// (signal poles, lamps, gas lanterns, hydrants, bollards, kiosks: built here with inert three.js stubs, since only its footprints matter). An
// obstacle within LANE_CLEAR of a lane closes the lane over its whole edge, and a lost one-way edge can take whole
// loops out of the largest strongly connected set, so a big drop with the furniture means a placement or lane geometry
// rule broke (docs/world.md). Measured 2026-10-28 on the 8.2 × 5.7 km detail box: bare 13097 edges long enough, 8704
// (433.7 km) in the set, 345 signalised junctions; with the 25059 furniture footprints (signal poles, lamps, hydrants,
// bollards, kiosks, ...) 8654 (430.4 km). (The 6.1 × 3.7 km box: 6635, 4235 (199.3 km), 168; 14026 footprints, 4218
// (198.5 km).) The rest of the bare graph is mostly cul-de-sacs and roads cut at the detail box. On the furnished
// network, pedestrian-routes.js lays 3310 crosswalks (4579 tracks; 22 of them split at a median or tram strip that is
// no curb island; the smaller box had 1602 and 2216, and 1388 / 1904 before the runs into merged junctions kept to
// their roadways, when many arms' curbs lay out of reach), the zebras road-paint.js paints: none overlapping (276 pairs
// when every edge end of the paint edges had one, 3616 zebras) and none ending in the roadway (2208 did).
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

test('most of the Poznań road graph survives the largest strongly connected set, street furniture included', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK } = loadModule(source, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info: (line) => logs.push(line) } },
    filename: 'road-network.js'
  });
  // street furniture keeps off the tram tracks through city-grid.js's track index (the module, not the built grid)
  const { clearOfRails } = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: { 'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
      './geodata.js': { GEO }, './tsl-materials.js': inert() },
    filename: 'city-grid.js'
  });
  const { buildStreetDetails } = loadModule(readFileSync(join(__dirname, '../js/street-details.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './road-network.js': { CROSSWALK, CROSSWALK_REACH, STOP_SETBACK }, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails }
    },
    globals: { console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
      Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
      document: inert() },
    filename: 'street-details.js'
  });
  const km = (net) => net.edges.reduce((sum, e) => sum + e.span, 0) / 1000;

  const bare = buildRoadNetwork([], []);
  const counts = /(\d+) long enough, (\d+) in the largest strongly connected set/.exec(logs.join('\n'));
  assert.ok(counts, 'the edge counts are logged');
  assert.equal(Number(counts[2]), bare.edges.length);
  assert.ok(Number(counts[1]) > 12500, `${counts[1]} edges long enough`);
  assert.ok(bare.edges.length > 8200 && km(bare) > 410, `${bare.edges.length} edges, ${km(bare).toFixed(1)} km in the set`);
  assert.ok(bare.nodes.filter((n) => n.signal).length > 310, 'signal sites mark their junctions');
  // OSM speed limits (GEO.roadGraph links): most of the network at the built-up 50 km/h, a good part in 30/20 zones
  const kmAt = (f) => bare.edges.filter((e) => f(Math.round(e.limit * 3.6))).reduce((sum, e) => sum + e.span, 0) / 1000;
  assert.ok(kmAt((v) => v === 50) > 0.4 * km(bare), `${kmAt((v) => v === 50).toFixed(1)} km at 50 km/h`);
  assert.ok(kmAt((v) => v <= 30) > 0.2 * km(bare), `${kmAt((v) => v <= 30).toFixed(1)} km at 30 km/h or less`);
  assert.ok(kmAt((v) => v >= 70) > 12, `${kmAt((v) => v >= 70).toFixed(1)} km at 70 km/h`);

  const { footprints, colliders } = buildStreetDetails(inert());
  assert.ok(footprints.length > 22000, `${footprints.length} street furniture footprints`);
  const furnished = buildRoadNetwork([], footprints);
  assert.ok(km(furnished) > 0.99 * km(bare), `${km(furnished).toFixed(1)} of ${km(bare).toFixed(1)} km survive the furniture`);
  // Crosswalks, and so zebras: none on top of another, both ends on a curb island, the walk 2 m onto it
  const { createPedestrianRoutes } = loadModule(readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8'), {
    imports: { './road-network.js': { CROSSWALK, CROSSWALK_REACH } }, filename: 'pedestrian-routes.js'
  });
  const { crosswalks, across } = createPedestrianRoutes(furnished, config.blockAt);
  const tracks = furnished.nodes.reduce((sum, n) => sum + across(n).length, 0);
  assert.ok(crosswalks.length > 3000 && tracks > 4200, `${crosswalks.length} crosswalks, ${tracks} tracks`);
  const h = (CROSSWALK - 0.3) / 2;
  const corners = (c) => [[c.ax, c.az], [c.bx, c.bz]].flatMap(([x, z]) => [[x - c.ux * h, z - c.uz * h], [x + c.ux * h, z + c.uz * h]]);
  const overlap = (p, q) => [[p.ux, p.uz], [-p.uz, p.ux], [q.ux, q.uz], [-q.uz, q.ux]].every(([ax, az]) => {
    const pd = corners(p).map(([x, z]) => x * ax + z * az), qd = corners(q).map(([x, z]) => x * ax + z * az);
    return Math.max(...pd) > Math.min(...qd) + 0.01 && Math.max(...qd) > Math.min(...pd) + 0.01;
  });
  const cells = new Map();
  for (const c of crosswalks) {
    const k = Math.floor((c.ax + c.bx) / 64) * 100000 + Math.floor((c.az + c.bz) / 64);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(c);
  }
  const overlaps = [];
  for (const c of crosswalks) {
    const ix = Math.floor((c.ax + c.bx) / 64), iz = Math.floor((c.az + c.bz) / 64);
    for (let x = ix - 1; x <= ix + 1; x++) {
      for (let z = iz - 1; z <= iz + 1; z++) {
        for (const o of cells.get(x * 100000 + z) || []) if (o !== c && overlap(c, o)) overlaps.push(`${c.ax.toFixed(0)},${c.az.toFixed(0)}`);
      }
    }
  }
  assert.deepEqual(overlaps, [], 'no two zebras overlap');
  // Every zebra ends on a curb island, or at a median or tram strip that is no island, where its walk goes on over the
  // strip to the zebra across the other roadway (a split crossing)
  const onStrip = (c, end) => c.tracks.some((t) => t.refuge?.[end]?.length);
  const offCurb = crosswalks.filter((c) => {
    const L = Math.hypot(c.bx - c.ax, c.bz - c.az), dx = (c.bx - c.ax) / L, dz = (c.bz - c.az) / L;
    return (!config.blockAt(c.ax - dx * 0.01, c.az - dz * 0.01) && !onStrip(c, 0))
      || (!config.blockAt(c.bx + dx * 0.01, c.bz + dz * 0.01) && !onStrip(c, 1));
  });
  assert.equal(offCurb.length, 0, 'every zebra ends on a curb island or a split crossing\'s strip');
  for (const c of crosswalks) {
    for (const t of c.tracks) {
      const end0 = t.refuge?.[0] || config.blockAt(t.ax, t.az);
      const end1 = t.refuge?.[1] || config.blockAt(t.ax + t.ux * t.len, t.az + t.uz * t.len);
      assert.ok(end0 && end1, 'and so does the walk');
      for (const end of [0, 1]) {
        for (const { track } of t.refuge?.[end] || []) {
          assert.ok(track.node !== t.node || track.side !== t.side, 'a split crossing goes on over another roadway');
          assert.ok(across(track.node).includes(track), 'whose crosswalk is kept');
        }
      }
    }
  }
  // Split crossings over a divided road's two roadways where its median or tram strip is no island: the Dworzec complex
  // (Roosevelta / Most Dworcowy, junction nodes around -1567, 560) had no zebra at all. Measured 2026-10-28: 1 there (a
  // split crossing of Roosevelta), 22 split zebras in all, 3310 zebras over the 8.2 × 5.7 km box (14 and 1602 over the
  // 6.1 × 3.7 km one; 1385 before the ports, 1375 before split crossings)
  const split = crosswalks.filter((c) => onStrip(c, 0) || onStrip(c, 1));
  const dworzec = crosswalks.filter((c) => Math.hypot((c.ax + c.bx) / 2 + 1567, (c.az + c.bz) / 2 - 560) < 150);
  assert.ok(dworzec.length > 0, 'zebras in the Dworzec complex');
  assert.ok(split.length >= 15 && split.length < 200, `${split.length} split zebras`);
  assert.ok(crosswalks.length < 3600, `${crosswalks.length} zebras: no flood of new ones`);

  // every piece of it is a player collider too, as small as the thing itself; street trees add trunk colliders without
  // a footprint (they are not traffic obstacles), so they are excluded from the footprint equality but keep the size check
  const propColliders = colliders.filter((c) => !c.isTrunk);
  assert.equal(propColliders.length, footprints.length);
  assert.ok(colliders.every((c) => c.maxX - c.minX < 3 && c.maxZ - c.minZ < 3 && c.maxY > 1 && c.maxY < 10),
    'street furniture colliders are prop-sized');
});

// Lane placement on the real network with the curbs city-grid.js hands over (curb islands' lot rects, medians as
// footprints), measured every 2.5 m along every lane of the largest strongly connected set:
// - off its roadway: the lane centre more than 0.3 m outside the carriageway of the nearest parallel OSM link going its
//   way (the link's width, less the tram strip in it);
// - over a curb: a car's width (±0.9 m) at the lane centre on a curb island or median;
// - phantom roadway: the outer lane more than 5 m from the curb on its right (room for a lane nobody drives);
// - on tram track where its carriageway is not: within 2.3 m of a track whose OSM carriageway is further off;
// - steep shifts: a straight move (two edges within 20°) whose path runs more than 15° across both roads, the lanes
//   jumping sideways at a bend or across a junction.
// Measured 2026-10-28 (before: the runs skewed into the merged junction centres, divided roadways moved onto one
// centreline, the tram strip centred on every tram link and 1 m bends at lane count changes): whole network off 0.7%
// (1.8%), over a curb 2.3% (3.4%), phantom roadway 3.0% (5.4%), on tram track 1.0% (1.0%), steep 2.0% (7.0%); Święty
// Marcin off 0.3% (4.3%, up to 7 m: lanes on the tracks by the Kaponiera), phantom 47.7% (56.8%: the rest is the plaza
// by the Zamek), steep 2 of 60 (7 of 38); Franklina Roosevelta off 0.2% (1.4%, up to 6.7 m), phantom 1.8% (5.6%),
// steep 0 of 124 (12 of 118). Over the 8.2 × 5.7 km box (2026-10-28, 174k samples against 80k): off 0.6%, over a
// curb 2.0%, phantom 1.8%, on tram track 0.5%, steep 1.8% (168 of 9559); the two streets unchanged. Paint and traffic
// use the same lanes and stop lines everywhere (6 stop lines were up to a few metres off where routing moved them
// after the paint snapshot).
test('lanes keep to their roadways, off curbs, medians and tram strips, without sideways jumps', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const { buildRoadNetwork } = loadModule(source, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {} } },
    filename: 'road-network.js'
  });
  const curbs = [];
  const medians = [];
  for (const b of config.BLOCKS) {
    if (b.park > 0.6 && !b.median && b.area > 250) continue;
    if (b.median) medians.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    else for (const [x0, x1, z0, z1] of b.rects) curbs.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  }
  const net = buildRoadNetwork(curbs, medians);

  // Segment grids: the OSM links (carriageway half width, one-way direction, name) and the tram tracks
  const C = 16;
  const file = (g, s) => {
    for (let ix = Math.floor((Math.min(s.ax, s.bx) - 12) / C); ix <= Math.floor((Math.max(s.ax, s.bx) + 12) / C); ix++) {
      for (let iz = Math.floor((Math.min(s.az, s.bz) - 12) / C); iz <= Math.floor((Math.max(s.az, s.bz) + 12) / C); iz++) {
        const k = ix * 100000 + iz;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(s);
      }
    }
  };
  const seg = (ax, az, bx, bz, extra) => {
    const L = Math.hypot(bx - ax, bz - az);
    return L < 0.1 ? null : { ax, az, bx, bz, ux: (bx - ax) / L, uz: (bz - az) / L, L, ...extra };
  };
  const roads = new Map();
  const RG = GEO.roadGraph;
  for (const [a, b, ni, w, , dir, inner, flags] of RG.links) {
    const p = [RG.nodes[2 * a], RG.nodes[2 * a + 1], ...inner, RG.nodes[2 * b], RG.nodes[2 * b + 1]];
    const carHalf = Math.max(1.65, ((flags & 2) ? w - 6.5 : w) / 2);
    for (let k = 0; k + 3 < p.length; k += 2) {
      const s = seg(p[k], p[k + 1], p[k + 2], p[k + 3], { carHalf, dir, name: RG.names[ni] });
      if (s) file(roads, s);
    }
  }
  const tracks = new Map();
  for (const r of GEO.rail) {
    if (r.kind !== 'tram') continue;
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const s = seg(r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3], { dir: 0 });
      if (s) file(tracks, s);
    }
  }
  // the nearest segment within 12 m running within ~25° of (dx, dz), going its way where it is one-way
  const nearest = (g, x, z, dx, dz) => {
    let best = null;
    let bd = 12;
    for (const s of g.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || []) {
      const c = s.ux * dx + s.uz * dz;
      if (Math.abs(c) < 0.9 || (s.dir && c * s.dir < 0)) continue;
      const t = Math.max(0, Math.min(s.L, (x - s.ax) * s.ux + (z - s.az) * s.uz));
      const d = Math.hypot(s.ax + s.ux * t - x, s.az + s.uz * t - z);
      if (d < bd) {
        bd = d;
        best = { s, d, x: s.ax + s.ux * t, z: s.az + s.uz * t };
      }
    }
    return best;
  };

  const tally = () => ({ samples: 0, off: 0, curb: 0, tram: 0, outer: 0, margin: 0, moves: 0, steep: 0 });
  const all = tally();
  const streets = { 'Święty Marcin': tally(), 'Franklina Roosevelta': tally() };
  const count = (n, key) => {
    all[key]++;
    if (n && streets[n.s.name]) streets[n.s.name][key]++;
  };
  for (const e of net.edges) {
    e.lanes.forEach((o, i) => {
      for (let s = 1; s < e.len - 1; s += 2.5) {
        const x = e.sx + e.dx * s + e.rx * o;
        const z = e.sz + e.dz * s + e.rz * o;
        const n = nearest(roads, x, z, e.dx, e.dz);
        count(n, 'samples');
        if (!n || n.d > n.s.carHalf + 0.3) count(n, 'off');
        if ([-0.9, 0, 0.9].some((k) => config.blockAt(x + e.rx * k, z + e.rz * k))) count(n, 'curb');
        const t = nearest(tracks, x, z, e.dx, e.dz);
        if (t && t.d < 2.3 && n) {
          const own = nearest(tracks, n.x, n.z, e.dx, e.dz);
          if (!own || own.d > 2.3) count(n, 'tram');
        }
        if (i === e.lanes.length - 1) {
          let d = 0.25;
          while (d <= 12 && !config.blockAt(x + e.rx * d, z + e.rz * d)) d += 0.25;
          if (d <= 12) {
            count(n, 'outer');
            if (d > 5) count(n, 'margin');
          }
        }
      }
    });
  }
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const e of net.edges) {
    for (const m of e.moves) {
      const f = m.to;
      if (m.turn !== 'S' || e.dx * f.dx + e.dz * f.dz < 0.94) continue;
      m.out.forEach((j, i) => {
        if (j < 0) return;
        const c = net.connector(e, i, f, j);
        let steep = 0;
        for (let k = 1; k < 16; k++) {
          net.curvePoint(c, (c.len * k) / 16, p);
          steep = Math.max(steep, Math.min(Math.abs(p.dx * e.dz - p.dz * e.dx), Math.abs(p.dx * f.dz - p.dz * f.dx)));
        }
        const n = nearest(roads, c.x0, c.z0, e.dx, e.dz);
        count(n, 'moves');
        if (steep > Math.sin((15 * Math.PI) / 180)) count(n, 'steep');
      });
    }
  }
  const share = (t, key, of) => t[key] / Math.max(1, t[of]);
  const pct = (t, key, of) => `${(100 * share(t, key, of)).toFixed(1)}%`;
  const report = (t) => `off ${pct(t, 'off', 'samples')}, curb ${pct(t, 'curb', 'samples')}, tram ${pct(t, 'tram', 'samples')}, ` +
    `phantom ${pct(t, 'margin', 'outer')}, steep ${t.steep} of ${t.moves}`;
  assert.ok(all.samples > 160000, `${all.samples} lane samples`);
  assert.ok(share(all, 'off', 'samples') < 0.012, report(all));
  assert.ok(share(all, 'curb', 'samples') < 0.03, report(all));
  assert.ok(share(all, 'margin', 'outer') < 0.04, report(all));
  assert.ok(share(all, 'tram', 'samples') < 0.015, report(all));
  assert.ok(share(all, 'steep', 'moves') < 0.035, report(all));
  const marcin = streets['Święty Marcin'];
  const roosevelta = streets['Franklina Roosevelta'];
  assert.ok(marcin.samples > 500 && roosevelta.samples > 1000);
  for (const t of [marcin, roosevelta]) {
    assert.ok(share(t, 'off', 'samples') < 0.01 && share(t, 'tram', 'samples') < 0.01 && t.steep <= 3, report(t));
  }
  assert.ok(share(roosevelta, 'margin', 'outer') < 0.03, report(roosevelta));

  // Paint (paintEdges) and traffic (edges) share every kept edge's lanes and stop line
  const keyOf = (e) => `${e.x0.toFixed(2)},${e.z0.toFixed(2)},${e.dx.toFixed(4)},${e.dz.toFixed(4)}`;
  const painted = new Map(net.paintEdges.map((q) => [keyOf(q), q]));
  for (const e of net.edges) {
    const q = painted.get(keyOf(e));
    assert.ok(q, 'every kept edge is painted');
    assert.deepEqual([...q.lanes], [...e.lanes]);
    assert.ok(Math.hypot(q.sx + q.dx * q.len - e.sx - e.dx * e.len, q.sz + q.dz * q.len - e.sz - e.dz * e.len) < 1e-6,
      'the stop line where traffic stops');
  }
});

test('an unsignalised bend is no junction: both ways through it have the right of way (group 0)', () => {
  // a 9 m street round a 120 m square: every corner a 90 degree bend
  const nodes = [0, 0, 120, 0, 120, 120, 0, 120];
  const links = [0, 1, 2, 3].map((i) => [i, (i + 1) % 4, 0, 9, 2, 0, []]);
  const net = buildPureGraph({ nodes, links, names: ['RING ST'] });
  assert.equal(net.nodes.length, 4);
  for (const n of net.nodes) {
    assert.ok(n.sideCount === 2 && !n.signal);
    assert.equal(new Set(n.arms.map((a) => a.group)).size, 2, 'its arms are more than 35 degrees off straight: two roads');
  }
  assert.equal(net.edges.length, 4, 'one way round (no U-turns): the largest strongly connected set');
  assert.ok(net.edges.every((e) => e.axisIndex === 0), 'neither way round a bend gives way to the other');
});
