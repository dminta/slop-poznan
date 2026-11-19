import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createOverrunTracker, instrumentTramsForOverruns } from '../tools/audit-tram-overruns.mjs';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const rawSource = readFileSync(join(root, 'js/trams.js'), 'utf8');
const instrumentedSource = instrumentTramsForOverruns(rawSource);

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

function loadTrams({ source = instrumentedSource, signalPhase = () => 'green' } = {}) {
  const exposed = source.replace(
    'return { group, update, trams, pool, graph, stops:',
    'return { drive, occupy, advance, rngState: () => rng, group, update, trams, pool, graph, stops:'
  );
  return loadModule(exposed, {
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
    globals: {
      Math, Object, Array, Set, Map, Number, Infinity, Float32Array, Float64Array,
      Uint8Array, Int32Array, Uint32Array, String, Error, console
    },
    filename: 'trams.js'
  });
}

const tramChain = (pts, oneway = 1, street = 1) => ({ kind: 'tram', street, tracks: 1, oneway, pts });
const roadEdge = (id, sx, sz, dx, dz, len, lanes) => ({ id, sx, sz, dx, dz, rx: -dz, rz: dx, len, lanes });

function stepSys(sys, tracker, activeTrams, time, dt = 1 / 20) {
  for (const t of activeTrams) sys.occupy(t);
  for (const t of activeTrams) sys.drive(t, time);
  for (const t of activeTrams) {
    sys.advance(t, dt);
    t.path.pointAt(t.path.u, t);
  }
  tracker.step(activeTrams, time + dt);
}

test('instrumentTramsForOverruns preserves simulation state and RNG stream identically', () => {
  const plain = loadTrams({ source: rawSource, signalPhase: (t) => (t < 2 ? 'green' : 'red') });
  const inst = loadTrams({ source: instrumentedSource, signalPhase: (t) => (t < 2 ? 'green' : 'red') });
  const network = { nodes: [{ x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] }], edges: [] };
  const rail = [tramChain([0, 0, 3000, 0])];
  const sA = plain.createTramSystem(inert(), { network, rail, stops: [], seed: 1922 });
  const sB = inst.createTramSystem(inert(), { network, rail, stops: [], seed: 1922 });
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  for (let k = 1; k <= 100; k++) {
    sA.update(0.05, k * 0.05, { x: 1000, z: 0 }, null, player, 'person');
    sB.update(0.05, k * 0.05, { x: 1000, z: 0 }, null, player, 'person');
  }
  assert.equal(sB.rngState(), sA.rngState());
  assert.equal(sB.trams.length, sA.trams.length);
  for (let i = 0; i < sA.trams.length; i++) {
    assert.equal(sB.trams[i].id, sA.trams[i].id);
    assert.equal(sB.trams[i].path.u, sA.trams[i].path.u);
    assert.equal(sB.trams[i].speed, sA.trams[i].speed);
    assert.equal(sB.trams[i].waitReason, sA.trams[i].waitReason);
  }
});

test('detects a synthetic true red-signal stop-line overrun and forward closed signal gate', () => {
  const { createTramSystem } = loadTrams({ signalPhase: () => 'red' });
  const signal = { x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] };
  const sys = createTramSystem(inert(), { network: { nodes: [signal], edges: [] }, rail: [tramChain([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t._overrunSpawnId = 1;
  t.path.reset(sys.graph.edges[0], 999.0, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 12; // unstoppable over the remaining 1 m to the stop line at x = 1000
  const tracker = createOverrunTracker({ seed: 7, district: 'test', warmup: 0 });

  for (let i = 0; i < 6; i++) stepSys(sys, tracker, [t], i * 0.05, 0.05);

  const summary = tracker.summary();
  const ev = tracker.events();
  assert.equal(summary.trueRedOverruns, 1);
  assert.equal(summary.committedSignalClearings, 0);
  assert.equal(ev.trueRedOverruns[0].seed, 7);
  assert.equal(ev.trueRedOverruns[0].district, 'test');
  assert.equal(ev.trueRedOverruns[0].tramId, t.id);
  assert.equal(ev.trueRedOverruns[0].committed, false);
  assert.equal(ev.trueRedOverruns[0].classification, 'true_red_overrun');
  assert.equal(ev.trueRedOverruns[0].signal.phase, 'red');
  assert.ok(ev.trueRedOverruns[0].overshoot > 0);
  assert.ok(ev.closedGateCrossings.some((g) => g.gateKind === 'signal' && g.crossingType === 'forward'));
});

test('distinguishes committed-in-complex clearings without false red or closed-gate positives', () => {
  let phase = 'green';
  const { createTramSystem } = loadTrams({ signalPhase: () => phase });
  const n = { x: 980, z: 0, in: [], out: [] };
  const e = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const f = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  e.to = n;
  e.moves = [{ to: f, turn: 'S', out: [0] }];
  n.in.push(e);
  const signal = { x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] };
  const network = {
    nodes: [n, signal],
    edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
  };
  const sys = createTramSystem(inert(), { network, rail: [tramChain([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t._overrunSpawnId = 1;
  t.path.reset(sys.graph.edges[0], 930, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 6;
  const tracker = createOverrunTracker({ seed: 11, district: 'test', warmup: 0 });

  let step = 0;
  while (t.path.u < 980 && step < 400) stepSys(sys, tracker, [t], step++ * 0.05, 0.05);
  assert.ok(t.path.u >= 980, 'tram crossed complex entry on green');
  phase = 'red';
  for (let i = 0; i < 300; i++) stepSys(sys, tracker, [t], step++ * 0.05, 0.05);

  const summary = tracker.summary();
  const ev = tracker.events();
  assert.equal(summary.trueRedOverruns, 0, 'no true red overrun when committed on green');
  assert.equal(summary.committedSignalClearings, 1, 'records the committed clearing separately');
  assert.equal(ev.committedSignalClearings[0].committed, true);
  assert.equal(ev.committedSignalClearings[0].classification, 'committed_complex_clearing');
  assert.equal(ev.committedSignalClearings[0].signal.inComplex, true);
  assert.equal(summary.closedGateCrossings, 0, 'no false-positive closed-gate crossings on committed clearing');
  assert.equal(summary.occupiedSwitchOverruns, 0);
});

test('detects synthetic occupied and claimed switch overruns', () => {
  for (const mode of ['occupied', 'claimed']) {
    const { createTramSystem } = loadTrams();
    // Crossing diamond at (1000, 0): t runs east along z = 0; other runs south along x = 1000.
    // Separate diverging switches or a crossing keeps occupy/claim cleanly independent of same-edge leaders.
    const rail = [
      tramChain([0, 0, 1000, 0]),
      tramChain([500, 100, 1000, 0]),
      tramChain([1000, 0, 3000, 0]),
      tramChain([1000, 0, 2000, 200])
    ];
    const sys = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail, stops: [] });
    const [t, other] = sys.pool;
    t.active = other.active = true;
    t._overrunSpawnId = 1;
    other._overrunSpawnId = 1;

    const e0 = sys.graph.edges[0]; // [0,0] -> [1000,0]
    const e1 = sys.graph.edges[1]; // [500,100] -> [1000,0]
    const e2 = sys.graph.edges[2]; // [1000,0] -> [3000,0]
    const e3 = sys.graph.edges[3]; // [1000,0] -> [2000,200]
    const entryU = 1000 - e0.foulEnd;

    t.path.reset(e0, entryU - 0.3, t.length + 8, () => 0);
    t.path.edges[t.path.n] = e2;
    t.path.start[t.path.n] = t.path.start[t.path.n - 1] + e0.len;
    t.path.n++;
    t.speed = 12; // crosses entryU before stopping

    if (mode === 'occupied') {
      // other straddles node (1000, 0) from branch e1 onto branch e3
      other.path.reset(e1, e1.len, other.length + 8, () => 0);
      other.path.edges[other.path.n] = e3;
      other.path.start[other.path.n] = other.path.start[other.path.n - 1] + e1.len;
      other.path.u += 5;
      other.path.n++;
      other.speed = 0;
    } else {
      // other approaches node (1000, 0) closer than t's distA
      other.path.reset(e1, e1.len - 2, other.length + 8, () => 0);
      other.path.edges[other.path.n] = e3;
      other.path.start[other.path.n] = other.path.start[other.path.n - 1] + e1.len;
      other.path.n++;
      other.speed = 4;
    }
    other.path.pointAt(other.path.u - other.length * 0.5, other);
    t.path.pointAt(t.path.u - t.length * 0.5, t);

    const tracker = createOverrunTracker({ seed: 19, district: 'test', warmup: 0 });
    stepSys(sys, tracker, [t, other], 0, 0.05);

    const summary = tracker.summary();
    const ev = tracker.events();
    assert.equal(summary.occupiedSwitchOverruns, 1, `detects ${mode} switch overrun`);
    assert.equal(ev.occupiedSwitchOverruns[0].switchKind, 'nodeSwitch');
    assert.equal(ev.occupiedSwitchOverruns[0].switchState, mode);
    assert.equal(ev.occupiedSwitchOverruns[0].blocker.tramId, other.id);
    assert.equal(ev.occupiedSwitchOverruns[0].x, 1000);
    assert.equal(ev.occupiedSwitchOverruns[0].z, 0);
  }
});

test('detects behind-tram closed-gate transitions once and handles path.trim continuity', () => {
  // 1. Uncommitted complex entry on unstoppable amber -> signal turns red while complexGate is behind front.
  let phase = 'amber';
  const { createTramSystem } = loadTrams({ signalPhase: () => phase });
  const n = { x: 980, z: 0, in: [], out: [] };
  const e = roadEdge(0, 980, -30, 0, 1, 28, [0]);
  const f = roadEdge(1, 980, 2, 0, 1, 28, [0]);
  e.to = n;
  e.moves = [{ to: f, turn: 'S', out: [0] }];
  n.in.push(e);
  const signal = { x: 1010, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 980, sz: 0, len: 20 }] };
  const network = {
    nodes: [n, signal],
    edges: [],
    connector: () => ({ x0: 980, z0: -2, x3: 980, z3: 2, len: 4 }),
    curvePoint(c, s, out) { out.x = c.x0; out.z = c.z0 + s; return out; }
  };
  const sys = createTramSystem(inert(), { network, rail: [tramChain([0, 0, 3000, 0])], stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t._overrunSpawnId = 1;
  // u = 976 (< 978.5 complexGate), stopLine = 1000 (gap = 24 < 12^2/(2*3)+1 = 25 -> unstoppable amber)
  t.path.reset(sys.graph.edges[0], 976, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 12;
  const tracker = createOverrunTracker({ seed: 23, district: 'test', warmup: 0 });

  let step = 0;
  while (t.path.u < 994 && step < 40) stepSys(sys, tracker, [t], step++ * 0.05, 0.05);
  assert.ok(t.path.u >= 994 && t.path.u < 1000);
  assert.equal(tracker.summary().closedGateCrossings, 0, 'amber gate was open while unstoppable');

  phase = 'red';
  for (let i = 0; i < 40; i++) stepSys(sys, tracker, [t], step++ * 0.05, 0.05);

  const behindEvents = tracker.events().closedGateCrossings.filter((g) => g.crossingType === 'behind');
  assert.equal(behindEvents.length, 1, 'behind-tram signal transition is recorded exactly once across frames');
  assert.equal(behindEvents[0].gateKind, 'signal');
  assert.equal(behindEvents[0].gateState.firstObservedBehind, true);
  assert.equal(behindEvents[0].gateState.wasPreviouslyOpen, true);
  assert.ok(behindEvents[0].gateState.dPre < 0);
  assert.equal(tracker.summary().trueRedOverruns, 1, 'subsequent stop-line crossing on red is also recorded');

  // 2. Behind-tram nodeSwitch closure + path.trim continuity across many short edges.
  const segs = [];
  for (let x = 0; x < 1000; x += 25) segs.push(tramChain([x, 0, x + 25, 0]));
  segs.push(tramChain([500, 100, 1000, 0])); // converging branch at x = 1000
  segs.push(tramChain([1000, 0, 2000, 0]));
  segs.push(tramChain([1000, 0, 2000, 200]));
  const sys2 = createTramSystem(inert(), { network: { nodes: [], edges: [] }, rail: segs, stops: [] });
  const [a, b] = sys2.pool;
  a.active = true;
  a._overrunSpawnId = 1;
  const joinIdx = segs.length - 4; // [975,0] -> [1000,0]
  const eJoin = sys2.graph.edges[joinIdx];
  const eOutA = sys2.graph.edges[segs.length - 2];
  const eInB = sys2.graph.edges[segs.length - 3];
  const eOutB = sys2.graph.edges[segs.length - 1];
  // Put tram a inside the foul zone (2 m past entryU, 2 m before node 1000) while switch is clear.
  a.path.reset(eJoin, eJoin.len - 2, a.length + 8, () => 0);
  a.path.edges[a.path.n] = eOutA;
  a.path.start[a.path.n] = a.path.start[a.path.n - 1] + eJoin.len;
  a.path.n++;
  a.speed = 0.5;
  a.path.pointAt(a.path.u - a.length * 0.5, a);
  const tracker2 = createOverrunTracker({ seed: 29, district: 'test', warmup: 0 });
  // Step 1 (spawn step): switch is open.
  stepSys(sys2, tracker2, [a], 0, 0.05);
  assert.equal(tracker2.summary().closedGateCrossings, 0);

  // Now b occupies the switch node while a's gate is already behind a's front -> triggers behind-tram closure!
  b.active = true;
  b._overrunSpawnId = 1;
  b.path.reset(eInB, eInB.len, b.length + 8, () => 0);
  b.path.edges[b.path.n] = eOutB;
  b.path.start[b.path.n] = b.path.start[b.path.n - 1] + eInB.len;
  b.path.u += 5;
  b.path.n++;
  b.speed = 0;
  b.path.pointAt(b.path.u - b.length * 0.5, b);
  for (let i = 1; i <= 5; i++) stepSys(sys2, tracker2, [a, b], i * 0.05, 0.05);

  const swBehind = tracker2.events().closedGateCrossings.filter((g) => g.gateKind === 'nodeSwitch' && g.crossingType === 'behind');
  assert.equal(swBehind.length, 1, 'behind-tram switch closure fires once across consecutive frames');
  assert.equal(swBehind[0].gateState.blocker, b.id);
  assert.ok(swBehind[0].gateState.dPre < 0);
});

test('does not false-trigger on gates already behind a fresh spawn and keeps tracking across path.trim()', () => {
  const { createTramSystem } = loadTrams({ signalPhase: () => 'red' });
  const segs = [];
  for (let x = 0; x < 600; x += 20) segs.push(tramChain([x, 0, x + 20, 0]));
  const signal = { x: 520, z: 0, signal: true, in: [{ dx: 1, dz: 0, axisIndex: 0, sx: 490, sz: 0, len: 20 }] };
  const sys = createTramSystem(inert(), { network: { nodes: [signal], edges: [] }, rail: segs, stops: [] });
  const t = sys.pool[0];
  t.active = true;
  t._overrunSpawnId = 1;
  // Spawn past x = 200 and drive across 20 m edges so path.trim() runs multiple times before reaching signal at 510.
  t.path.reset(sys.graph.edges[10], 5, t.length + 8, () => 0);
  t.path.extend(200, () => 0);
  t.speed = 6;
  const tracker = createOverrunTracker({ seed: 31, district: 'test', warmup: 0 });
  for (let i = 0; i < 600; i++) stepSys(sys, tracker, [t], i * 0.05, 0.05);

  assert.equal(tracker.summary().trueRedOverruns, 0, 'stops cleanly before red stop line at x = 510');
  assert.equal(tracker.summary().occupiedSwitchOverruns, 0);

  // Separate check: fresh spawn inside a nodeSwitch foul zone already held by another tram must not emit behind-spawn false event.
  const { createTramSystem: createSys2 } = loadTrams();
  const rail2 = [
    tramChain([0, 0, 1000, 0]),
    tramChain([500, 100, 1000, 0]),
    tramChain([1000, 0, 2000, 0]),
    tramChain([1000, 0, 2000, 200])
  ];
  const sys2 = createSys2(inert(), { network: { nodes: [], edges: [] }, rail: rail2, stops: [] });
  const [a, b] = sys2.pool;
  a.active = b.active = true;
  a._overrunSpawnId = b._overrunSpawnId = 1;
  const e0 = sys2.graph.edges[0], e1 = sys2.graph.edges[1], e2 = sys2.graph.edges[2], e3 = sys2.graph.edges[3];
  a.path.reset(e0, e0.len - 1.5, a.length + 8, () => 0);
  a.path.edges[a.path.n] = e2;
  a.path.start[a.path.n] = a.path.start[a.path.n - 1] + e0.len;
  a.path.n++;
  a.speed = 0;
  a.path.pointAt(a.path.u - a.length * 0.5, a);

  b.path.reset(e1, e1.len, b.length + 8, () => 0);
  b.path.edges[b.path.n] = e3;
  b.path.start[b.path.n] = b.path.start[b.path.n - 1] + e1.len;
  b.path.u += 5;
  b.path.n++;
  b.speed = 0;
  b.path.pointAt(b.path.u - b.length * 0.5, b);

  const tracker2 = createOverrunTracker({ seed: 37, district: 'test', warmup: 0 });
  for (let i = 0; i < 4; i++) stepSys(sys2, tracker2, [a, b], i * 0.05, 0.05);
  assert.equal(tracker2.summary().closedGateCrossings, 0, 'already-behind gate at spawn establishes baseline without false crossing');
});
