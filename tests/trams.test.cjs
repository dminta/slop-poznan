const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/trams.js'), 'utf8');

// Absorbs every three.js / material call createTramSystem makes (as in road-network.test.cjs)
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

function load(signalPhase = () => 'green', driving = false) {
  // Expose the real simulation steps for controlled two-tram queues, without random spawn/respawn or rendering.
  const code = driving ? source.replace('return { group, update, trams, pool, graph, stops:',
    'return { drive, occupy, advance, group, update, trams, pool, graph, stops:') : source;
  return loadModule(code, {
    imports: {
      'three/webgpu': inert(),
      './geodata.js': { GEO: { rail: [], tramStops: [] } },
      './city-config.js': { signalPhase },
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.3 } } },
      './actor-models.js': inert(),
      './vehicle-lights.js': {
        HEADLIGHTS: { busIntensity: 900 },
        tramLightSpec: (len) => ({ headlight: [0.82, 0.9], zFront: len / 2 }),
        createVehicleHeadlight: () => inert(),
        placeVehicleHeadlight() {}
      }
    },
    globals: { Math, Object, Array, Set, Map, Number, Infinity, Float32Array, Float64Array, Uint8Array, Int32Array, Uint32Array, String, Error, console },
    filename: 'trams.js'
  });
}

const tram = (pts, oneway = 1, street = 1) => ({ kind: 'tram', street, tracks: 1, oneway, pts });
const ids = (edges) => [...edges].map((e) => e.chain).sort((a, b) => a - b);

test('switches continue only within the turn limit, one-way chains run one way, dead ends have no successor', () => {
  const { buildTrackGraph } = load();
  const rail = [
    tram([0, 0, 50, 0, 100, 0]), // 0: approach, eastbound
    tram([100, 0, 200, 0]), // 1: straight on
    tram([100, 0, 180, 60]), // 2: diverging 36.9 degrees: a switch
    tram([100, 0, 150, 100]), // 3: 63 degrees: not from chain 0
    tram([100, 0, 0, 5]), // 4: back the way it came: never
    { kind: 'rail', street: 0, tracks: 1, oneway: 0, pts: [0, 0, 100, 0] } // heavy rail is not tram track
  ];
  const g = buildTrackGraph(rail);
  assert.equal(g.edges.length, 5, 'one directed edge per one-way tram chain, none for rail');
  const approach = g.edges.find((e) => e.chain === 0);
  assert.deepEqual(ids(approach.next), [1, 2]);
  assert.equal(approach.reverse, null);
  for (const chain of [1, 2, 3, 4]) {
    const e = g.edges.find((f) => f.chain === chain);
    assert.equal(e.next.length, 0, `chain ${chain} ends at a dead end`);
    assert.equal(e.flip, false);
  }
  assert.ok(Math.abs(approach.len - 100) < 1e-9);
  assert.equal(approach.to, g.edges.find((e) => e.chain === 1).from, 'equal end coordinates share one node');
});

test('two-way chains: single track both ways, a double-track pair takes right-hand running', () => {
  const { buildTrackGraph } = load();
  const rail = [
    tram([0, 0, 100, 0, 200, 0], 0), // 0: single track, no neighbour
    tram([0, 50, 150, 50, 300, 50], 0), // 1: north track of a pair (z = -north)
    tram([0, 53.5, 150, 53.5, 300, 53.5], 0) // 2: south track, 3.5 m away
  ];
  const g = buildTrackGraph(rail);
  const of = (chain) => [...g.edges].filter((e) => e.chain === chain);
  assert.equal(of(0).length, 2);
  assert.equal(of(0)[0].reverse, of(0)[1]);
  assert.ok(of(0)[0].run >= 0 && of(0)[0].run === of(0)[1].run, 'a single-track block');
  assert.equal(of(0)[0].runDir, -of(0)[1].runDir);
  // Heading east the right-hand (south, +z) track is chain 2; the north track runs west, against its pts
  assert.deepEqual(of(1).map((e) => e.flip), [true]);
  assert.deepEqual(of(2).map((e) => e.flip), [false]);
  assert.equal(of(1)[0].run, -1);
});

test('crossings off the nodes are found, and curve limits come from the turn', () => {
  const { buildTrackGraph, TRAM_DRIVER } = load();
  const arc = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    arc.push(100 + 30 * Math.sin(a), 100 - 30 * Math.cos(a)); // clear of the crossing pair
  }
  const g = buildTrackGraph([tram([0, -40, 0, 40]), tram([-40, 0, 40, 0]), tram(arc, 1, 0)]);
  const [ns, ew] = [g.edges[0], g.edges[1]];
  assert.equal(ns.crossings.length, 1);
  assert.ok(Math.abs(ns.crossings[0].s - 40) < 1e-6 && ns.crossings[0].other === ew);
  assert.ok(Math.abs(ew.crossings[0].os - 40) < 1e-6);
  const curve = g.edges[2];
  const expected = Math.sqrt(TRAM_DRIVER.aLat * 30);
  for (let i = 1; i < 12; i++) assert.ok(Math.abs(curve.vmax[i] - expected) / expected < 0.02, `${curve.vmax[i]} m/s on R = 30 m`);
  assert.equal(curve.vmax[0], Infinity);
});

test('tram stops snap to the nearest track within 6 m, or attach by rail index and direction', () => {
  const { buildTrackGraph, snapTramStops, attachTramStops } = load();
  const rail = [tram([0, 0, 200, 0]), tram([200, 3.2, 0, 3.2]), tram([0, 40, 200, 40], 0)];
  const g = buildTrackGraph(rail);
  const placed = snapTramStops(g, [
    { name: 'Wschód', x: 80, z: 0.4 }, // on the eastbound track
    { name: 'Zachód', x: 120, z: 3.0 }, // on the westbound track, 3 m from the other
    { name: 'Daleko', x: 50, z: 20 } // too far from any track
  ]);
  assert.deepEqual([...placed].map((s) => s.name), ['Wschód', 'Zachód']);
  assert.equal(placed[0].at.length, 1);
  assert.equal(placed[0].at[0].edge.chain, 0);
  assert.ok(Math.abs(placed[0].at[0].s - 80) < 1e-9);
  assert.equal(placed[1].at[0].edge.chain, 1);
  assert.ok(Math.abs(placed[1].at[0].s - 80) < 1e-9, 'arc length along the westbound pts');

  const g2 = buildTrackGraph(rail);
  const attached = attachTramStops(g2, [
    { name: 'Rondo', x: 150, z: 40, railIndex: 2, s: 150, dir: -1 },
    { name: 'Most', x: 60, z: 0, railIndex: 0, s: 60, dir: 1 },
    { name: 'Pod prąd', x: 60, z: 0, railIndex: 0, s: 60, dir: -1 } // the graph runs chain 0 only along its pts
  ]);
  assert.deepEqual([...attached].map((s) => s.name), ['Rondo', 'Most']);
  const back = attached[0].at[0];
  assert.equal(back.edge.flip, true);
  assert.ok(Math.abs(back.s - 50) < 1e-9, 'measured along the reversed edge');
  assert.equal(g2.edges.find((e) => e.chain === 2 && e.flip).stops[0].stop, attached[0]);
});

test('signalised junctions near a track get a stop line and the group of the road it arrives along', () => {
  const { buildTrackGraph, findTrackSignals } = load();
  const g = buildTrackGraph([tram([0, 0, 200, 0]), tram([60, -100, 60, 100])]);
  const road = (dx, dz, axisIndex, endX, endZ) => ({ dx, dz, axisIndex, sx: endX - dx * 20, sz: endZ - dz * 20, len: 20 });
  const nodes = [
    { x: 60, z: 1.5, signal: true, in: [road(1, 0, 1, 52, 1.5), road(0, 1, 0, 60, -8)] },
    { x: 150, z: 30, signal: true, in: [road(1, 0, 0, 140, 30)] }, // 30 m off the track
    { x: 100, z: 0, signal: false, in: [road(1, 0, 0, 92, 0)] }
  ];
  const sigs = findTrackSignals(g, nodes);
  const east = g.edges[0].signals;
  assert.equal(east.length, 1);
  assert.equal(east[0].group, 1, 'arrives along the group-1 road');
  assert.ok(Math.abs(east[0].s - (60 - Math.hypot(8, 0))) < 1e-6, 'stop line as far out as the arm\'s');
  const south = g.edges[1].signals;
  assert.equal(south[0].group, 0);
  assert.ok(Math.abs(south[0].s - (101.5 - 9.5)) < 1e-6);
  assert.equal(sigs.length, 2);
});

test('articulated sections stay joined around a curve and add up to ~32 m', () => {
  const { buildTrackGraph, TramPath, poseSections, TRAM_MODELS } = load();
  const R = 25;
  const pts = [-80, 0, 0, 0];
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI;
    pts.push(R * Math.sin(a), R - R * Math.cos(a));
  }
  pts.push(-80, 2 * R);
  const g = buildTrackGraph([tram(pts)]);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const model of Object.values(TRAM_MODELS)) {
    assert.ok(Math.abs(model.length - 32) < 0.5, `${model.name} is ${model.length} m`);
    const path = new TramPath();
    path.reset(g.edges[0], 80 + R * Math.PI * 0.8, model.length + 10, rand);
    const out = model.sections.map(() => ({}));
    poseSections(path, path.u, model, out);
    let chords = 0;
    for (let k = 0; k < out.length; k++) {
      const s = out[k];
      assert.equal(s.halfLength, model.sections[k].len / 2);
      assert.equal(s.halfWidth, 1.2);
      for (const [x, z] of [[s.fx, s.fz], [s.rx, s.rz]]) {
        if (x > 0) assert.ok(Math.abs(Math.hypot(x, z - R) - R) < 0.1, 'section ends ride on the curve');
      }
      chords += Math.hypot(s.fx - s.rx, s.fz - s.rz);
      if (k > 0) {
        const p = out[k - 1];
        const joint = Math.hypot(p.rx - s.fx, p.rz - s.fz);
        assert.ok(joint < model.gap + 0.2, `${model.name} joint ${k}: ${joint.toFixed(3)} m apart`);
        let dh = Math.abs(p.heading - s.heading);
        if (dh > Math.PI) dh = 2 * Math.PI - dh;
        assert.ok(dh > 0.05, 'sections bend round the curve');
      }
    }
    assert.ok(Math.abs(chords + model.gap * (out.length - 1) - model.length) < 0.6, `${model.name}: ${chords.toFixed(2)} m of body`);
  }
});

test('a tram path chooses its branches ahead, trims behind and stops at a dead end', () => {
  const { buildTrackGraph, TramPath } = load();
  const g = buildTrackGraph([tram([0, 0, 100, 0]), tram([100, 0, 300, 0]), tram([100, 0, 290, 60]), tram([300, 0, 400, 0])]);
  const rand = () => 0.99; // always the last branch
  const path = new TramPath();
  path.reset(g.edges[0], 50, 40, rand);
  path.extend(400, rand);
  assert.deepEqual([...path.edges.slice(0, path.n)].map((e) => e.chain), [0, 2]);
  assert.ok(Math.abs(path.end - (100 + g.edges[2].len)) < 1e-9, 'the diverging branch ends at a dead end');
  path.u += 120;
  path.trim(40);
  assert.deepEqual([...path.edges.slice(0, path.n)].map((e) => e.chain), [2]);
  assert.ok(Math.abs(path.u - 70) < 1e-9);
  const p = path.pointAt(path.u, {});
  const e = g.edges[2];
  assert.ok(Math.abs(p.x - (100 + e.stx * 70)) < 1e-9 && Math.abs(p.z - e.stz * 70) < 1e-9);
});

test('trams run the line, dwell 20-30 s at stops, hold at red and never run into each other', () => {
  let red = false;
  const { createTramSystem } = load((_time, group0) => (group0 && red ? 'red' : 'green'));
  // A 3 km double-track line with two stops and a signal
  const rail = [tram([0, 0, 3000, 0]), tram([3000, 3.4, 0, 3.4])];
  const stops = [{ name: 'Rynek Łazarski', x: 1500, z: 0 }, { name: 'Most Teatralny', x: 1500, z: 3.4 }];
  const network = { nodes: [{ x: 2200, z: 1.7, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 2180, sz: 1.7, len: 10 }] }] };
  const sys = createTramSystem(inert(), { network, rail, stops });
  assert.equal(sys.stops.length, 2);
  assert.equal(sys.signals.length, 2);
  const focus = { x: 1500, z: 0 };
  const dwells = new Map();
  let served = 0;
  let maxDwell = 0;
  let heldAtRed = 0;
  for (let f = 0, time = 0; f < 15 * 300; f++) {
    const dt = 1 / 15;
    time += dt;
    red = time > 200 && time < 260;
    sys.update(dt, time, focus, inert());
    for (const t of sys.trams) {
      assert.ok(t.speed >= 0 && t.speed < 70 / 3.6);
      assert.equal(t.sections.length, t.spec.sections.length);
      if (t.atStop) dwells.set(t, (dwells.get(t) || 0) + dt);
      else if (dwells.has(t)) {
        served++;
        maxDwell = Math.max(maxDwell, dwells.get(t));
        assert.ok(dwells.get(t) >= 19.9 && dwells.get(t) <= 30.1, `dwelled ${dwells.get(t)} s`);
        dwells.delete(t);
      }
      if (red && t.waitReason === 'signal' && t.speed < 0.1) heldAtRed++;
    }
    if (f % 8) continue;
    for (const a of sys.trams) {
      for (const b of sys.trams) {
        if (a === b || Math.abs(a.z - b.z) > 1) continue; // other track
        const gap = Math.abs(a.x - b.x) - (a.length + b.length) / 2;
        assert.ok(gap > 1, `trams ${a.id} and ${b.id} overlap at t = ${time.toFixed(1)}`);
      }
    }
  }
  assert.ok(sys.trams.length > 10, `${sys.trams.length} trams on the line`);
  assert.ok(served >= 4, `${served} stops served`);
  assert.ok(heldAtRed > 0, 'trams wait at the red signal');
  for (const t of sys.trams) {
    assert.ok(Math.hypot(t.sections[0].fx - t.frontX, t.sections[0].fz - t.frontZ) < 1e-9);
    assert.equal(typeof t.stopName, 'string');
  }
});

// A straight road edge as road-network.js lays them: s from (sx, sz) along (dx, dz); lane offsets along (rx, rz), the
// right of the travel direction
function roadEdge(id, sx, sz, dx, dz, len, lanes) {
  return { id, sx, sz, dx, dz, rx: -dz, rz: dx, len, lanes, moves: [] };
}

test('track over car lanes maps onto them once: the lane, its stretch and its way', () => {
  const { buildTrackGraph, mapTramsToRoads } = load();
  // Eastbound road along z = 0 (its right is +z): lanes at z = 1.8 and 5.4; the westbound twin at z = -1.8 and -5.4
  const east = roadEdge(0, 0, 0, 1, 0, 200, [1.8, 5.4]);
  const west = roadEdge(1, 200, 0, -1, 0, 200, [1.8, 5.4]);
  const rail = [
    tram([0, 2.0, 250, 2.0]), // eastbound street track in the inner eastbound lane
    tram([120, -50, 120, 50]) // a track across the road at x = 120
  ];
  const graph = buildTrackGraph(rail);
  mapTramsToRoads(graph, { edges: [east, west] });
  const along = graph.edges.find((e) => e.chain === 0);
  assert.equal(along.lanes.length, 1, 'only the lane the track runs in (the next one is 3.4 m off)');
  const run = along.lanes[0];
  assert.equal(run.edge, east);
  assert.equal(run.lane, 0);
  assert.equal(run.dir, 1);
  assert.ok(run.s0 === 0 && Math.abs(run.s1 - 200) < 1.01, `[${run.s0}, ${run.s1}]`);
  assert.ok(Math.abs(run.l0) < 1.01 && Math.abs(run.l1 - 200) < 1.01);
  const across = graph.edges.find((e) => e.chain === 1);
  const hits = across.lanes.map((r) => `${r.edge.id}:${r.lane}:${r.dir}`).sort().join(' ');
  assert.equal(hits, '0:0:0 0:1:0 1:0:0 1:1:0', 'every lane it crosses, as a crossing');
  for (const r of across.lanes) {
    assert.ok(r.s1 - r.s0 < 6, 'a crossing is a short stretch of track');
    assert.ok(Math.abs(r.l0 - (r.edge === east ? 120 : 80)) < 0.01 && Math.abs(r.l1 - r.l0) < 0.01, 'at the crossing point');
    assert.ok(r.pad > 1.5, 'reaching the tram width along the lane');
  }
  assert.equal(along.roadLimit, Infinity, 'no posted limit on the road: the tram keeps its own');
  assert.equal(across.roadLimit, Infinity, 'crossing a road does not take its limit');
  east.limit = west.limit = 30 / 3.6;
  mapTramsToRoads(graph, { edges: [east, west] });
  assert.equal(along.roadLimit, 30 / 3.6, 'street running in a 30 zone');
  assert.equal(graph.edges.find((e) => e.chain === 1).roadLimit, Infinity);
});

test('junction curves over the track are listed on the tram edge and the road node', () => {
  const { buildTrackGraph, mapTramsToRoads } = load();
  const node = { x: 100, z: 0, in: [], out: [] };
  const north = roadEdge(0, 98.2, -60, 0, 1, 56, [0]); // southbound (+z) towards the junction, lane on its line
  const westOut = roadEdge(1, 96, 6, -1, 0, 50, [0]); // and out to the west, south of the track
  north.to = node;
  north.moves = [{ to: westOut, turn: 'R', out: [0] }];
  node.in.push(north);
  // the curve from lane to lane drawn straight
  const network = {
    nodes: [node],
    edges: [],
    connector: (e, i, f, j) => {
      const x0 = e.sx + e.dx * e.len + e.rx * e.lanes[i], z0 = e.sz + e.dz * e.len + e.rz * e.lanes[i];
      const x3 = f.sx + f.rx * f.lanes[j], z3 = f.sz + f.rz * f.lanes[j];
      return { x0, z0, x3, z3, len: Math.hypot(x3 - x0, z3 - z0) };
    },
    curvePoint: (c, s, out) => {
      const k = s / c.len;
      out.x = c.x0 + (c.x3 - c.x0) * k;
      out.z = c.z0 + (c.z3 - c.z0) * k;
      return out;
    }
  };
  const graph = buildTrackGraph([tram([0, 0, 200, 0]), tram([0, 40, 200, 40])]);
  mapTramsToRoads(graph, network);
  const under = graph.edges.find((e) => e.chain === 0);
  assert.equal(under.junctions.length, 1, 'the curve through the junction crosses the track at z = 0');
  const c = under.junctions[0];
  assert.equal(c.node, node);
  assert.ok(c.e === north && c.i === 0 && c.f === westOut && c.j === 0);
  assert.ok(c.s0 < 97.5 && c.s1 > 97.5 && c.s1 - c.s0 < 12, `[${c.s0}, ${c.s1}]`);
  assert.equal(node.tramConflicts.length, 1);
  assert.equal(node.tramConflicts[0], c);
  assert.equal(graph.edges.find((e) => e.chain === 1).junctions.length, 0, 'the other track is 34 m beyond the curve');
});

// Trams on a double-track line with a car (or the player) standing on the eastbound track at x = 1500 until t = 100 s
function obstacleRun(setup) {
  const { createTramSystem } = load();
  const rail = [tram([0, 0, 3000, 0]), tram([3000, 3.4, 0, 3.4])];
  const car = { edge: {}, x: 1500, z: 0, yaw: Math.PI / 2, yawOffset: 0, half: 2.25, halfWidth: 0.9, tx: 1, tz: 0, speed: 0, vx: 0, vz: 0 };
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops: [], traffic: { cars: [car], buses: [] } });
  const player = { type: 'person', position: { x: -1e4, y: 0, z: 0 }, heading: 0, speed: 0 };
  setup(car, player);
  const seen = new Set();
  let passed = 0;
  for (let f = 0, time = 0; f < 15 * 160; f++) {
    const dt = 1 / 15;
    time += dt;
    if (time > 100) car.z = player.position.z = 30; // out of the way
    sys.update(dt, time, { x: 1500, z: 0 }, inert(), player, 'person');
    for (const t of sys.trams) {
      if (Math.abs(t.z) > 1) continue; // the westbound track
      const rearX = t.sections[t.sections.length - 1].rx;
      if (time < 100 && rearX < 1490) assert.ok(t.frontX < 1497.7, `tram ${t.id} runs into the obstacle (front at ${t.frontX.toFixed(2)})`);
      if (time < 100 && t.speed < 0.05 && t.frontX > 1480 && t.frontX < 1497.7) seen.add(t.waitReason);
      if (time > 100 && rearX < 1490 && t.frontX > 1505) passed++;
    }
  }
  return { seen, passed };
}

test('trams brake for a car on the track ahead and run on once it has cleared', () => {
  const { seen, passed } = obstacleRun(() => {});
  assert.deepEqual([...seen], ['car']);
  assert.ok(passed > 0, 'trams pass once the car is gone');
});

test('trams brake for the player on the track, but not for a car facing them (it cannot back out)', () => {
  const { seen } = obstacleRun((car, player) => {
    car.z = 30;
    player.position.x = 1500;
    player.position.z = 0;
  });
  assert.deepEqual([...seen], ['player']);
  const { createTramSystem } = load();
  const facing = { edge: {}, x: 1500, z: 0, yaw: -Math.PI / 2, yawOffset: 0, half: 2.25, halfWidth: 0.9, tx: -1, tz: 0, speed: 0, vx: 0, vz: 0 };
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail: [tram([0, 0, 3000, 0])], stops: [], traffic: { cars: [facing], buses: [] } });
  for (let f = 0, time = 0; f < 15 * 60; f++) {
    time += 1 / 15;
    sys.update(1 / 15, time, { x: 1500, z: 0 }, inert());
    for (const t of sys.trams) assert.notEqual(t.waitReason, 'car');
  }
});

test('trams brake for a pedestrian within ~1.7 m of the track ahead, not for one further off', () => {
  const { createTramSystem } = load();
  for (const [offset, stops] of [[1.4, true], [2.2, false]]) {
    // standing beside the eastbound track at x = 1500 until t = 100 s
    const ped = { placed: true, x: 1500, z: offset, ux: 1, uz: 0, dir: 1, v: 0 };
    const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail: [tram([0, 0, 3000, 0])], stops: [],
      traffic: { cars: [], buses: [], peds: [ped] } });
    const seen = new Set();
    let passed = 0;
    for (let f = 0, time = 0; f < 15 * 160; f++) {
      time += 1 / 15;
      if (time > 100) ped.z = 30;
      sys.update(1 / 15, time, { x: 1500, z: 0 }, inert());
      for (const t of sys.trams) {
        const rearX = t.sections[t.sections.length - 1].rx;
        if (stops && time < 100 && rearX < 1490) assert.ok(t.frontX < 1499.5, `tram ${t.id} runs into the pedestrian`);
        if (time < 100 && t.frontX > 1480 && t.frontX < 1500) seen.add(t.waitReason);
        if (rearX < 1490 && t.frontX > 1505) passed++;
      }
    }
    assert.equal(seen.has('pedestrian'), stops, `pedestrian ${offset} m off the track`);
    assert.ok(passed > 0, 'trams pass');
  }
});

test('a tram path follows its line route at switches, rejoins it across a gap and turns at its terminus', () => {
  const { buildTrackGraph, TramPath } = load();
  const routed = (pts, routes) => Object.assign(tram(pts), { routes });
  const g = buildTrackGraph([
    routed([0, 0, 100, 0], [0, 1]), // 0: both lines
    routed([100, 0, 300, 0], [0]), // 1: line 0 straight on
    routed([100, 0, 290, 60], [1]), // 2: line 1 diverges
    routed([300, 0, 400, 0], []), // 3: a connecting piece missing from line 0's relation
    routed([400, 0, 600, 0], [0]), // 4: line 0 again
    routed([300, 0, 480, 60], []) // 5: a branch no line uses
  ]);
  const chains = (path) => [...path.edges.slice(0, path.n)].map((e) => e.chain);
  for (const [route, rand, expected] of [[0, 0.99, [0, 1, 3, 4]], [0, 0, [0, 1, 3, 4]], [1, 0, [0, 2]], [-1, 0.99, [0, 2]], [-1, 0, [0, 1, 3, 4]]]) {
    const path = new TramPath();
    path.route = route;
    path.reset(g.edges[0], 50, 40, () => rand);
    path.extend(1000, () => rand);
    assert.deepEqual(chains(path), expected, `route ${route}, rand ${rand}`);
  }
  // Past the end of its route (a terminus loop the relation leaves out) it takes the same line's other direction
  const lines = [{ ref: '5', from: 'Górczyn PKM', to: 'Zawady' }, { ref: '6', from: 'Zawady', to: 'Miłostowo' }, { ref: '5', from: 'Zawady', to: 'Górczyn PKM' }];
  const loop = buildTrackGraph([
    routed([0, 0, 100, 0], [0]),
    routed([100, 0, 130, 10, 150, 40, 130, 70, 100, 80], []),
    routed([100, 80, 0, 80], [1, 2])
  ]);
  const turn = new TramPath(lines);
  turn.route = 0;
  turn.reset(loop.edges[0], 50, 40, () => 0);
  turn.extend(400, () => 0);
  assert.deepEqual(chains(turn), [0, 1, 2]);
  assert.equal(turn.route, 2, 'line 5 now runs to Górczyn PKM');
});

test('line 5 keeps its Zawady destination until its front reaches the return route', async () => {
  const { GEO } = await import('../js/geodata.js');
  const { createTramSystem, nearestOnEdge } = load(() => 'green', true);
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail: GEO.rail, stops: [], routes: GEO.tramRoutes });
  const outbound = GEO.tramRoutes.findIndex((r) => r.ref === '5' && r.to === 'Zawady');
  const inbound = GEO.tramRoutes.findIndex((r) => r.ref === '5' && r.to === 'Górczyn PKM');
  assert.equal(outbound, 7);
  assert.equal(inbound, 6);
  const near = {};
  let distance = Infinity;
  const edge = sys.graph.edges.reduce((closest, e) => {
    if (!e.routes.includes(outbound)) return closest;
    const d = nearestOnEdge(e, 1650.1, -561.4, near).d;
    if (d >= distance) return closest;
    distance = d;
    return e;
  }, null);
  assert.ok(edge, 'outbound track near Zawady');
  const t = sys.pool[0];
  t.path.route = outbound;
  t.path.reset(edge, 0, t.length + 8, () => 0);
  t.path.extend(2000, () => 0);
  const transition = t.path.edges.findIndex((e, i) => i < t.path.n && e.routes.includes(inbound) && !e.routes.includes(outbound));
  assert.ok(transition > 0, 'path reaches the return direction');
  t.route = outbound;
  t.line = '5';
  t.destination = 'Zawady';
  t.speed = 0;
  t.acc = 0;
  t.path.u = t.path.start[transition] - 0.01;
  sys.advance(t, 0);
  assert.equal(t.route, outbound, 'display remains route 7 before the return edge');
  assert.equal(t.destination, 'Zawady');
  t.path.u = t.path.start[t.path.indexAt(t.path.u) + 1];
  sys.advance(t, 0);
  assert.equal(t.route, inbound, 'display changes to route 6 on the return edge');
  assert.equal(t.destination, 'Górczyn PKM');
});

test('a tram whose route stops for good takes the route of the track it runs on, not a siding no line uses', () => {
  const { buildTrackGraph, TramPath } = load();
  const routed = (pts, routes) => Object.assign(tram(pts), { routes });
  const lines = [{ ref: '10', from: 'Dębiec PKM', to: 'Błażeja' }, { ref: '3', from: 'Górczyn PKM', to: 'Wilczy Młyn' }];
  const g = buildTrackGraph([
    routed([0, 0, 100, 0], [0]), // 0: line 10's relation ends here
    routed([100, 0, 300, 0], [1]), // 1: line 3 runs on
    routed([100, 0, 290, -60], []), // 2: a siding
    routed([300, 0, 500, 0], [1])
  ]);
  for (const rand of [0, 0.5, 0.99]) {
    const path = new TramPath(lines);
    path.route = 0;
    path.reset(g.edges[0], 50, 40, () => rand);
    path.extend(400, () => rand);
    assert.deepEqual([...path.edges.slice(0, path.n)].map((e) => e.chain), [0, 1, 3], `rand ${rand}`);
    assert.equal(path.route, 1, 'now line 3');
  }
});

test('every tram runs a line with a number and a terminus and keeps to its route', () => {
  const { createTramSystem } = load();
  const routed = (pts, routes) => Object.assign(tram(pts), { routes });
  const rail = [routed([0, 0, 1000, 0], [0, 1]), routed([1000, 0, 3000, 0], [0]), routed([1000, 0, 2900, 600], [1])];
  const routes = [{ ref: '7', from: 'Ogrody', to: 'Połabska' }, { ref: '8', from: 'Ogrody', to: 'Miłostowo' }];
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops: [], routes });
  assert.equal(sys.routes, routes);
  const seen = new Set();
  for (let f = 0, time = 0; f < 15 * 120; f++) {
    time += 1 / 15;
    sys.update(1 / 15, time, { x: 1200, z: 0 }, inert());
    for (const t of sys.trams) {
      assert.ok(t.route === 0 || t.route === 1);
      assert.equal(t.line, routes[t.route].ref);
      assert.equal(t.destination, routes[t.route].to);
      seen.add(t.line);
      for (let i = 0; i < t.path.n; i++) assert.ok(t.path.edges[i].routes.includes(t.route), `line ${t.line} off its route`);
    }
  }
  assert.deepEqual([...seen].sort(), ['7', '8']);
});

test('on the Poznań network the lines follow their routes, line 17 over Most Chrobrego to Katedra', async () => {
  const { GEO } = await import('../js/geodata.js');
  const { buildTrackGraph, TramPath, nearestOnEdge } = load();
  const graph = buildTrackGraph(GEO.rail);
  assert.ok(GEO.tramRoutes.length >= 30, `${GEO.tramRoutes.length} routes`);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let on = 0;
  let all = 0;
  GEO.tramRoutes.forEach((r, route) => {
    const edges = graph.edges.filter((e) => e.routes.includes(route));
    assert.ok(edges.length > 0, `line ${r.ref} to ${r.to} has track`);
    for (const e of edges) {
      const path = new TramPath();
      path.route = route;
      path.reset(e, 0, 0, rand);
      path.extend(3000, rand);
      for (let i = 0; i < path.n; i++) {
        all += path.edges[i].len;
        if (path.edges[i].routes.includes(route)) on += path.edges[i].len;
      }
    }
  });
  // Measured 98.6%: the rest is past a route's last track in the box or across crossings the relations map loosely
  assert.ok(on / all > 0.95, `${(100 * on / all).toFixed(1)}% of the laid-out paths on the route`);
  // Line 17 to Starołęka from Małe Garbary: over Most Chrobrego (x ≈ 746, z ≈ -149), past Katedra, over Most Mieszka I
  const route = GEO.tramRoutes.findIndex((r) => r.ref === '17' && r.to === 'Starołęka PKM');
  const katedra = GEO.tramStops.find((s) => s.name === 'Katedra');
  const near = { d: 0, s: 0, tx: 0, tz: 0 };
  const start = graph.edges.filter((e) => e.routes.includes(route)).sort((a, b) => nearestOnEdge(a, 400, -200, near).d - nearestOnEdge(b, 400, -200, {}).d)[0];
  const path = new TramPath();
  path.route = route;
  path.reset(start, 0, 0, rand);
  path.extend(1500, rand);
  const passes = (x, z) => path.edges.slice(0, path.n).some((e) => nearestOnEdge(e, x, z, near).d < 6);
  assert.ok(passes(746, -149), 'over Most Chrobrego');
  assert.ok(passes(katedra.x, katedra.z), 'past Katedra');
  assert.ok(passes(1154, -216), 'over Most Mieszka I');
});

function queueScenario(rail, front, leaderFront, stops = [], options = {}) {
  const { createTramSystem } = load(() => 'green', true);
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops, ...options });
  const [follower, leader] = sys.pool;
  function place(t, x) {
    t.active = true;
    t.path.reset(sys.graph.edges.find((e) => e.chain === (x < 1000 ? 0 : 1)) || sys.graph.edges[0],
      x < 1000 || sys.graph.edges.length === 1 ? x : x - 1000, t.length + 8, () => 0);
    t.path.extend(200, () => 0);
    t.speed = 0;
    t.x = x - t.length / 2;
    t.z = 0;
    sys.occupy(t);
  }
  place(follower, front);
  place(leader, leaderFront);
  function tick(seconds) {
    for (let frame = 0; frame < seconds * 30; frame++) {
      sys.occupy(follower);
      sys.drive(follower, frame / 30);
      sys.advance(follower, 1 / 30);
      follower.path.pointAt(follower.path.u, follower);
    }
  }
  return { sys, follower, leader, tick };
}

test('a queue beyond a switch holds a tram before the fouling point and releases it when the exit clears', () => {
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0]), tram([1000, 0, 2800, 600])];
  const { sys, follower, leader, tick } = queueScenario(rail, 950, 1055);
  const entry = 1000 - sys.graph.edges[0].foulEnd;
  tick(25);
  assert.ok(follower.x < entry, `front ${follower.x} stays before clearance point ${entry}`);
  assert.equal(follower.waitReason, 'room');
  leader.active = false;
  tick(20);
  assert.ok(follower.x - follower.length > 1000 + sys.graph.edges[1].foulStart, 'whole tram clears the switch');
});

test('a queue beyond an uncut crossing holds the tram outside the crossing', () => {
  // Keep a chain boundary at 1000 for the controlled leader placement; crossing itself is inside chain 0.
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0]), tram([980, -300, 980, 300])];
  const { follower, leader, tick } = queueScenario(rail, 930, 1030);
  tick(25);
  assert.ok(follower.x < 971, `front ${follower.x} stays before crossing clearance`);
  assert.equal(follower.waitReason, 'room');
  leader.active = false;
  tick(20);
  assert.ok(follower.x - follower.length > 989, 'whole tram passes the crossing after release');
});

test('a tram already inside a switch clears it instead of applying a reservation behind its front', () => {
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0]), tram([1000, 0, 2800, 600])];
  const { sys, follower } = queueScenario(rail, 998, 1055);
  sys.drive(follower, 0);
  assert.notEqual(follower.waitReason, 'switch');
  assert.ok(follower.acc > 0, 'moves toward the leader to clear the junction');
});

test('an occupied stop keeps the next tram outside the platform footprint', () => {
  const stops = [{ name: 'Platform', x: 1100, z: 0 }];
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0])];
  const { follower, leader, tick } = queueScenario(rail, 1050, 1111.2, stops);
  tick(25);
  assert.ok(follower.x < 1100 - follower.length * 0.65, `front ${follower.x} stays outside the occupied platform`);
  assert.ok(['room', 'tram'].includes(follower.waitReason));
  assert.equal(follower.leader, leader);
  leader.active = false;
  tick(25);
  assert.equal(follower.atStop, true, 'enters and serves the platform after it clears');
});

test('tram signals use the timing of their associated road node', () => {
  const node = { x: 1100, z: 0, signal: true, signalTiming: { offset: 17 },
    in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 1080, sz: 0, len: 10 }] };
  let seen = null;
  const { createTramSystem } = load((_time, _group0, signalNode) => {
    seen = signalNode;
    return 'red';
  }, true);
  const sys = createTramSystem(inert(), { network: { nodes: [node], edges: [] }, rail: [tram([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.path.reset(sys.graph.edges[0], 1050, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 0;
  t.x = 1050;
  t.z = 0;
  sys.drive(t, 10);
  assert.equal(seen, node);
  assert.equal(t.waitReason, 'signal');
});

test('a queue beyond a mainline level crossing leaves the crossing clear', () => {
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0])];
  const { follower, leader, tick } = queueScenario(rail, 930, 1030, [], { levelCrossings: [980, 0] });
  tick(25);
  assert.ok(follower.x < 971, `front ${follower.x} stays outside the mainline crossing`);
  assert.equal(follower.waitReason, 'room');
  leader.active = false;
  tick(20);
  assert.ok(follower.x - follower.length > 989, 'clears mainline crossing after the queue moves');
});

test('a tram waiting for exit room does not claim a switch ahead of a tram on another approach', () => {
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0]), tram([500, -100, 1000, 0]),
    tram([1000, 0, 2800, -600])];
  const { sys, follower, leader } = queueScenario(rail, 950, 1055);
  const other = sys.pool[2];
  other.active = true;
  other.path.reset(sys.graph.edges[2], sys.graph.edges[2].len - 59, other.length + 8, () => 0);
  other.path.extend(200, () => 0);
  other.speed = 0;
  other.path.pointAt(other.path.u, other);
  sys.occupy(other);
  sys.drive(follower, 0);
  assert.ok(follower.clearance < 50, 'queue holds the closer approach before the switch');
  // The other approach turns off before the waiting tram's leader; it can clear its own exit.
  other.path.edges[1] = sys.graph.edges[3];
  sys.drive(other, 0);
  assert.notEqual(other.waitReason, 'switch', 'does not yield to an approach that cannot enter');
  assert.ok(other.acc > 0);
  assert.equal(leader.active, true);
});

test('a queued tram keeps the road junction crossing clear as well as other tracks', () => {
  const n = { x: 980, z: 0, in: [], out: [] };
  const approach = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const exit = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  approach.to = n;
  approach.moves = [{ to: exit, turn: 'S', out: [0] }];
  n.in.push(approach);
  const network = {
    nodes: [n], edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) {
      out.x = c.x0;
      out.z = c.z0 + s;
      return out;
    }
  };
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 3000, 0])];
  const { sys, follower, leader, tick } = queueScenario(rail, 930, 1030, [], { network });
  assert.equal(sys.graph.edges[0].junctions.length, 1);
  tick(25);
  assert.ok(follower.x < sys.graph.edges[0].junctions[0].s0, `front ${follower.x} stays outside the road crossing`);
  leader.active = false;
  tick(20);
  assert.ok(follower.x - follower.length > sys.graph.edges[0].junctions[0].s1, 'whole tram clears the road after release');
});

test('a curb stop offset cannot make a dwelling tram block a road crossing', () => {
  const road = { x: 980, z: 0, in: [], out: [] };
  const approach = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const exit = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  approach.to = road;
  approach.moves = [{ to: exit, turn: 'S', out: [0] }];
  road.in.push(approach);
  const network = {
    nodes: [road], edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
  };
  const rail = [tram([0, 0, 3000, 0])];
  for (const [kind, s, moved] of [['curb', 972, true], ['curb', 900, false], ['island', 972, false]]) {
    const stops = [{ name: 'Near crossing', x: s, z: 0, railIndex: 0, s, dir: 1, kind }];
    const { createTramSystem } = load(() => 'green', true);
    const sys = createTramSystem(inert(), { network, rail, stops });
    const t = sys.pool[0];
    t.active = true;
    t.path.reset(sys.graph.edges[0], s - 25, t.length + 8, () => 0);
    t.path.extend(200, () => 0);
    t.speed = 0;
    t.x = s - 25;
    t.z = 0;
    const crossing = sys.graph.edges[0].keepClear[0];
    for (let f = 0; f < 30 * 20 && !t.atStop; f++) {
      sys.occupy(t);
      sys.drive(t, f / 30);
      sys.advance(t, 1 / 30);
      t.path.pointAt(t.path.u, t);
    }
    assert.equal(t.atStop, true, `${kind} stop at ${s} is served`);
    if (moved) {
      assert.ok(s + t.length * 0.35 > crossing.end, 'unmodified nose would be past crossing while tail blocked it');
      assert.ok(t.path.u <= crossing.start - 0.5, 'whole dwelling tram stays before the road crossing');
    } else {
      assert.ok(Math.abs(t._stopU - (s + t.length * 0.35)) < 1e-6, 'safe curb and fixed island targets stay unchanged');
    }
    assert.ok(t.dwell >= 20 && t.dwell <= 30, 'normal dwell duration is preserved');
  }
});

test('keep-clear reservations exclude straight shared lanes but retain crossing, turning and converging curves', () => {
  const { createTramSystem } = load();
  const cases = [
    { label: 'same way', a: [90, 0], b: [110, 0.1], incoming: [1, 0.005], outgoing: [1, 0.005], reserved: false },
    { label: 'opposite way', a: [110, 0], b: [90, 0.1], incoming: [-1, 0.005], outgoing: [-1, 0.005], reserved: false },
    { label: 'crossing', a: [100, -10], b: [100, 10], incoming: [0, 1], outgoing: [0, 1], reserved: true },
    { label: 'turning onto track', a: [95, -5], b: [105, 0], incoming: [0, 1], outgoing: [1, 0], reserved: true },
    { label: 'converging', a: [90, -1], b: [110, 1], incoming: [1, 0], outgoing: [1, 0], reserved: true }
  ];
  for (const spec of cases) {
    const n = { x: 100, z: 0, in: [], out: [] };
    const e = roadEdge(0, spec.a[0] - spec.incoming[0] * 30, spec.a[1] - spec.incoming[1] * 30,
      ...spec.incoming, 30, [0]);
    const f = roadEdge(1, ...spec.b, ...spec.outgoing, 30, [0]);
    e.to = n;
    e.moves = [{ to: f, turn: 'S', out: [0] }];
    n.in.push(e);
    const len = Math.hypot(spec.b[0] - spec.a[0], spec.b[1] - spec.a[1]);
    const network = {
      nodes: [n], edges: [],
      connector: () => ({ x0: spec.a[0], z0: spec.a[1], x3: spec.b[0], z3: spec.b[1], len, curv: 0 }),
      curvePoint(_c, s, out) {
        out.x = spec.a[0] + (spec.b[0] - spec.a[0]) * s / len;
        out.z = spec.a[1] + (spec.b[1] - spec.a[1]) * s / len;
        return out;
      }
    };
    const sys = createTramSystem(inert(), { network, rail: [tram([0, 0, 200, 0])], stops: [] });
    const track = sys.graph.edges[0];
    assert.equal(track.junctions.length, 1, `${spec.label}: car occupancy and holds remain present`);
    assert.equal(track.keepClear.length, spec.reserved ? 1 : 0, `${spec.label}: crossing reservation`);
  }
});

test('exit-room holds move before a protected complex instead of leaving the rear across its first crossing', () => {
  for (const first of [980, 900]) {
    const nodes = [];
    for (const x of [first, 1000]) {
      const n = { x, z: 0, in: [], out: [] };
      const e = roadEdge(nodes.length * 2, x, -30, 0, 1, 28, [0]);
      const f = roadEdge(nodes.length * 2 + 1, x, 2, 0, 1, 28, [0]);
      e.to = n;
      e.moves = [{ to: f, turn: 'S', out: [0] }];
      n.in.push(e);
      nodes.push(n);
    }
    const network = {
      nodes, edges: [],
      connector: (e) => ({ x0: e.sx, z0: -2, x3: e.sx, z3: 2, len: 4 }),
      curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
    };
    const { sys, follower, leader, tick } = queueScenario([tram([0, 0, 3000, 0])], first - 50, 1060, [], { network });
    tick(25);
    const front = follower.path.u;
    const rear = front - follower.length;
    for (const c of sys.graph.edges[0].keepClear) {
      assert.ok(front < c.start || rear > c.end, `body [${rear}, ${front}] leaves crossing clear`);
    }
    if (first === 980) assert.ok(front < 978.5, 'holds before the first crossing of the short complex');
    else assert.ok(rear > 901.5 && front < 998.5, 'a long enough gap between crossings remains usable');
    assert.equal(follower.waitReason, 'room');
    leader.active = false;
    tick(20);
    assert.ok(follower.path.u - follower.length > 1001.5, 'whole tram passes the complex once the exit clears');
  }
});

test('a short pair of switches is reserved as one complex before queuing behind a dwelling tram', () => {
  const { createTramSystem } = load(() => 'green', true);
  const rail = [tram([0, 0, 1000, 0]), tram([1000, 0, 1020, 0]), tram([1020, 0, 3000, 0]),
    tram([1000, 0, 1600, 200]), tram([1020, 0, 1600, -200])];
  const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops: [] });
  const [t, leader] = sys.pool;
  for (const [v, edge, s, x] of [[t, sys.graph.edges[0], 930, 930], [leader, sys.graph.edges[2], 60, 1080]]) {
    v.active = true;
    v.path.reset(edge, s, v.length + 8, () => 0);
    v.path.extend(200, () => 0);
    v.speed = 0;
    v.x = x;
    v.z = 0;
    sys.occupy(v);
  }
  const tick = (seconds) => {
    for (let i = 0; i < seconds * 30; i++) {
      sys.occupy(t);
      sys.drive(t, i / 30);
      sys.advance(t, 1 / 30);
      t.path.pointAt(t.path.u, t);
    }
  };
  tick(25);
  assert.ok(t.path.pointAt(t.path.u, {}).x < 1000 - sys.graph.edges[0].foulEnd,
    'front remains outside the first switch instead of stranding its rear on it');
  assert.equal(t.waitReason, 'room');
  leader.active = false;
  tick(30);
  const local = t.path.pointAt(t.path.u - t.length, {});
  assert.ok(local.x > 1020 + sys.graph.edges[2].foulStart, 'whole body clears both switches after release');
});

test('a red stop line beyond a crossing holds the whole tram before the crossing and releases it on green', () => {
  let red = true;
  const { createTramSystem } = load(() => red ? 'red' : 'green', true);
  const n = { x: 980, z: 0, in: [], out: [] };
  const e = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const f = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  e.to = n;
  e.moves = [{ to: f, turn: 'S', out: [0] }];
  n.in.push(e);
  const signal = { x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] };
  const network = {
    nodes: [n, signal], edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
  };
  const sys = createTramSystem(inert(), { network, rail: [tram([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t.path.reset(sys.graph.edges[0], 930, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 0;
  t.x = 930;
  t.z = 0;
  function tick(seconds) {
    for (let i = 0; i < seconds * 30; i++) {
      sys.occupy(t);
      sys.drive(t, i / 30);
      sys.advance(t, 1 / 30);
      t.path.pointAt(t.path.u, t);
    }
  }
  tick(25);
  assert.ok(t.path.u < 978.5, 'red does not leave the rear standing on the preceding crossing');
  assert.equal(t.waitReason, 'signal');
  red = false;
  tick(20);
  assert.ok(t.path.u - t.length > 981.5, 'whole tram passes once its own signal turns green');
});

test('a tram committed past a complex entry on green clears it when the downstream head turns red', () => {
  let red = false;
  const { createTramSystem } = load(() => red ? 'red' : 'green', true);
  const n = { x: 980, z: 0, in: [], out: [] };
  const e = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const f = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  e.to = n;
  e.moves = [{ to: f, turn: 'S', out: [0] }];
  n.in.push(e);
  const signal = { x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] };
  const network = {
    nodes: [n, signal], edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
  };
  const sys = createTramSystem(inert(), { network, rail: [tram([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t.path.reset(sys.graph.edges[0], 930, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 0;
  t.x = 930;
  t.z = 0;
  let time = 0;
  const step = () => {
    sys.occupy(t);
    sys.drive(t, time);
    sys.advance(t, 1 / 30);
    t.path.pointAt(t.path.u, t);
    time += 1 / 30;
  };
  while (t.path.u < 980 && time < 30) step();
  assert.ok(t.path.u >= 980, 'crosses the protected entry on green');
  red = true;
  for (let i = 0; i < 600; i++) step();
  assert.ok(t.path.u - t.length > 981.5, 'a later red cannot strand its body across the previous crossing');
});

test('a tram held before a switch or crossing does not claim its future approach', () => {
  for (const kind of ['switch', 'crossing']) {
    const { createTramSystem } = load(() => 'green', true);
    const rail = kind === 'switch'
      ? [tram([0, 0, 1000, 0]), tram([500, 100, 1000, 0]), tram([1000, 0, 3000, 0])]
      : [tram([0, 0, 3000, 0]), tram([980, -1000, 980, 1000])];
    const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops: [] });
    const [t, other] = sys.pool;
    t.active = other.active = true;
    t.path.reset(sys.graph.edges[0], kind === 'switch' ? 960 : 930, t.length + 8, () => 0);
    t.path.extend(200, () => 0);
    t.speed = 0;
    t.path.pointAt(t.path.u, t);
    const edge = sys.graph.edges[1];
    other.path.reset(edge, kind === 'switch' ? edge.len - 20 : 980, other.length + 8, () => 0);
    other.path.extend(200, () => 0);
    other.path.pointAt(other.path.u, other);
    other.speed = 0;
    sys.occupy(other);
    for (const why of ['stop', 'signal', 'car', 'pedestrian', 'player', 'room']) {
      other.atStop = why === 'stop';
      other.waitReason = why;
      sys.drive(t, 0);
      assert.notEqual(t.waitReason, 'switch', `${kind}: does not wait for a stationary tram held by ${why}`);
      assert.ok(t.acc > 0, `${kind}: free approach moves`);
    }
    other.atStop = false;
    for (const why of ['switch', 'block', '']) {
      other.waitReason = why;
      sys.drive(t, 0);
      assert.equal(t.waitReason, 'switch', `${kind}: ordinary ${why || 'free'} contenders retain priority`);
    }
    other.waitReason = 'signal';
    other.speed = 2;
    sys.drive(t, 0);
    assert.equal(t.waitReason, 'switch', `${kind}: a moving tram still has its approach priority`);
    if (kind === 'crossing') {
      other.path.reset(edge, 1015, other.length + 8, () => 0);
      other.path.extend(200, () => 0);
      other.path.pointAt(other.path.u, other);
      other.speed = 0;
      other.atStop = true;
      sys.occupy(other);
      sys.drive(t, 0);
      assert.equal(t.waitReason, 'switch', 'a dwelling tram whose body occupies the crossing still blocks it');
    } else {
      other.path.reset(sys.graph.edges[2], 10, other.length + 8, () => 0.99);
      other.path.extend(200, () => 0);
      other.path.pointAt(other.path.u, other);
      other.speed = 0;
      other.atStop = true;
      sys.occupy(other);
      t.speed = 8;
      for (let i = 0; i < 15 * 30; i++) {
        sys.drive(t, i / 30);
        sys.advance(t, 1 / 30);
        t.path.pointAt(t.path.u, t);
      }
      assert.ok(t.x < 1000 - sys.graph.edges[0].foulEnd, 'a body straddling the merge still holds its clearance point');
    }
  }
});

test('on the Poznań network track signals attach to junctions with valid signalTiming plan index and group 0 or 1', async () => {
  const { GEO } = await import('../js/geodata.js');
  const config = await import('../js/city-config.js');
  const roadNetworkSource = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
  const network = loadModule(roadNetworkSource, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {} } }, filename: 'road-network.js'
  }).buildRoadNetwork([], []);

  const { buildTrackGraph, findTrackSignals } = load();
  const graph = buildTrackGraph(GEO.rail);
  const sigs = findTrackSignals(graph, network.nodes);

  assert.ok(sigs.length >= 180, `expected >= 180 track signals on Poznań network, got ${sigs.length}`);
  for (const sig of sigs) {
    assert.ok(sig.node && sig.node.signalTiming, 'junction node must have signalTiming');
    assert.equal(typeof sig.node.signalTiming.index, 'number', 'signalTiming must provide numeric plan index');
    assert.ok(sig.node.signalTiming.index >= 0 && sig.node.signalTiming.index < config.SIGNAL_PLANS.length);
    assert.ok(sig.group === 0 || sig.group === 1, `group must be 0 or 1, got ${sig.group}`);
    assert.ok(Number.isFinite(sig.s), 'stop line s must be finite');
    assert.ok(sig.edge, 'signal must reference track edge');
  }
});
