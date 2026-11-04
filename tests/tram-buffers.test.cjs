const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/trams.js'), 'utf8');

// Absorbs every three.js / material call createTramSystem makes (as in trams.test.cjs)
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

// Expose the population internals normally closed over by createTramSystem.
function load() {
  const code = source.replace('return { group, update, trams, pool, graph, stops:',
    'return { spawn, nearEdges, group, update, trams, pool, graph, stops:');
  return loadModule(code, {
    imports: {
      'three/webgpu': inert(),
      './geodata.js': { GEO: { rail: [], tramStops: [] } },
      './city-config.js': { signalPhase: () => 'green' },
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

const tram = (pts) => ({ kind: 'tram', street: 1, tracks: 1, oneway: 1, pts });
const rand = () => 0.5;

test('spawns keep off the last 200 m of a buffer approach', () => {
  const { createTramSystem } = load();
  const short = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 120, 0])], // the whole edge is a buffer approach
    stops: []
  });
  short.nearEdges.push(short.graph.edges[0]);
  for (let i = 0; i < 50; i++) {
    short.pool[0].active = false;
    assert.equal(short.spawn(short.pool[0], 60, 0, 0, false), false, 'no spawn on buffer-bound track');
  }
  assert.equal(short.pool[0].active, false);

  const long = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 4000, 0])], // starts well over 200 m before its buffer
    stops: []
  });
  long.nearEdges.push(long.graph.edges[0]);
  let spawned = 0;
  for (let i = 0; i < 50; i++) {
    long.pool[0].active = false;
    if (!long.spawn(long.pool[0], 60, 0, 0, false)) continue;
    spawned++;
    assert.ok(long.pool[0].path.end === Infinity || long.pool[0].path.end - long.pool[0].path.u >= 200,
      `spawn at ${(long.pool[0].path.end - long.pool[0].path.u).toFixed(0)} m before a buffer`);
  }
  assert.ok(spawned > 0, 'track further from a buffer still spawns');
});

test('a hidden queue on a buffer approach retires together instead of one tram at a time', () => {
  const { createTramSystem } = load();
  const sys = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 200, 0])],
    stops: []
  });
  const edge = sys.graph.edges[0];
  const focus = { x: 60, z: 0 };
  const dt = 1 / 15;
  // First frame initialises the focus (a jump would retire whatever is active).
  sys.update(dt, dt, focus, null);
  const [front, queued] = sys.pool;
  for (const [t, u] of [[front, 198], [queued, 160]]) {
    t.active = true;
    t.path.reset(edge, u, t.length + 10, rand);
    t.path.extend(400, rand);
    t.x = u;
    t.z = 0;
    t.speed = 0;
    t.acc = 0;
    t.atStop = false;
    t.deadEndWait = 0;
    t.bufferWait = 0;
    t.stuck = 0;
  }
  let time = dt;
  for (let f = 0; f < 15 * 4; f++) {
    time += dt;
    sys.update(dt, time, focus, null); // no camera: both are out of view
  }
  assert.equal(front.active, false, 'the buffer stop tram left');
  assert.equal(queued.active, false, 'the tram queued behind it left too, not after 90 s of stuck');
});

test('buffer retirement does not count on a moving tram', () => {
  const { createTramSystem } = load();
  const sys = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 1000, 0])],
    stops: []
  });
  const edge = sys.graph.edges[0];
  const focus = { x: 500, z: 0 };
  const dt = 1 / 15;
  sys.update(dt, dt, focus, null);
  const t = sys.pool[0];
  t.active = true;
  t.path.reset(edge, 900, t.length + 10, rand);
  t.path.extend(400, rand);
  t.x = 900;
  t.z = 0;
  t.speed = 10;
  t.acc = 0;
  t.atStop = false;
  t.deadEndWait = 0;
  t.bufferWait = 0;
  t.stuck = 0;
  let time = dt;
  for (let f = 0; f < 5; f++) {
    time += dt;
    sys.update(dt, time, focus, null);
    assert.equal(t.bufferWait, 0, 'a moving tram is not on the queue clock');
  }
  assert.equal(t.active, true);
});

test('the tram seed is injectable without changing the default', () => {
  const { createTramSystem } = load();
  const make = (seed) => createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 500, 0])],
    stops: [],
    seed
  });
  const a = make(7).pool.map((t) => t.v0Factor);
  const b = make(7).pool.map((t) => t.v0Factor);
  const c = make(8).pool.map((t) => t.v0Factor);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(make(1922).pool[0].v0Factor, createTramSystem(inert(), {
    network: { nodes: [], edges: [] }, rail: [tram([0, 0, 500, 0])], stops: []
  }).pool[0].v0Factor, 'the default is still 1922');
});

test('a tram still in the frustum beyond 250 m is not retired', () => {
  const { createTramSystem } = load();
  const sys = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 1000, 0])],
    stops: []
  });
  const edge = sys.graph.edges[0];
  const focus = { x: 500, z: 0 };
  const camera = { position: { x: 0, y: 30, z: 0 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    projectionMatrix: {}, matrixWorldInverse: {}, updateMatrixWorld() {} };
  const dt = 1 / 15;
  sys.update(dt, dt, focus, camera);
  const t = sys.pool[0];
  t.active = true;
  t.path.reset(edge, 900, t.length + 10, rand);
  t.path.extend(400, rand);
  t.x = 900;
  t.z = 0;
  t.speed = 0;
  t.acc = 0;
  t.atStop = false;
  t.deadEndWait = 0;
  t.bufferWait = 0;
  t.stuck = 0;
  let time = dt;
  for (let f = 0; f < 15 * 4; f++) {
    time += dt;
    sys.update(dt, time, focus, camera);
  }
  assert.equal(t.active, true, '900 m away but inside TRAM_CULL and the frustum');
});