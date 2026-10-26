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

function load(signalPhase = () => 'green') {
  return loadModule(source, {
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
    globals: { Math, Object, Array, Set, Map, Number, Infinity, Float32Array, Float64Array, String, Error },
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
