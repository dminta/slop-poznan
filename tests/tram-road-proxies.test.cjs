const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/trams.js'), 'utf8');

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

const imports = {
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
};
const globals = {
  Math, Object, Array, Set, Map, Number, Infinity, Float32Array, Float64Array, Uint8Array, Int32Array, Uint32Array,
  String, Error, console
};

// Expose the spawn check that normally stays inside createTramSystem, and its random state.
function load() {
  return loadModule(source.replace('return { group, update, trams, pool, graph, stops:',
    'return { bufferAhead, rngState: () => rng, group, update, trams, pool, graph, stops:'),
  { imports, globals, filename: 'trams.js' });
}

const tram = (pts) => ({ kind: 'tram', street: 1, tracks: 1, oneway: 1, pts });

test('a crossing lane proxy holds a stopped car nose clear of the tram body', () => {
  const trams = loadModule(source, { imports, globals, filename: 'trams.js' });
  const graph = trams.buildTrackGraph([tram([0, 0, 100, 0])]);
  const network = {
    nodes: [],
    edges: [
      // crosses the track square on at x = 50
      { id: 7, sx: 50, sz: -40, dx: 0, dz: 1, rx: -1, rz: 0, len: 80, lanes: [0] },
      // runs along the track 1 m beside it, inside ROAD_OVERLAP
      { id: 8, sx: 0, sz: 1, dx: 1, dz: 0, rx: 0, rz: 1, len: 100, lanes: [0] }
    ]
  };
  trams.mapTramsToRoads(graph, network);
  const runs = graph.edges.flatMap((e) => e.lanes);
  const crossing = runs.find((r) => r.edge.id === 7);
  assert.ok(crossing, 'the lane crossing the track is mapped');
  assert.equal(crossing.dir, 0);
  // The proxy has to keep a stopped car's nose (half width 0.92 m) outside the tram's 1.2 m body, not just hold
  // the tram's own width: at Kaponiera a car stopped 0.1 m inside it held the line 10 tram that was waiting for it.
  assert.ok(crossing.pad >= trams.TRAM_HALF_WIDTH + 0.92,
    `crossing pad ${crossing.pad.toFixed(2)} m covers the car's half width`);
  const parallel = runs.find((r) => r.edge.id === 8);
  assert.ok(parallel, 'the lane beside the track is mapped');
  assert.notEqual(parallel.dir, 0);
  assert.ok(parallel.pad <= 0.51, `a lane along the track keeps its 0.5 m pad (${parallel.pad.toFixed(2)} m)`);
});

test('the spawn gate sees a free-ending buffer 200 m ahead without drawing tram random numbers', () => {
  const { createTramSystem } = load();
  const near = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 200, 0])], // a detail-box style dead end 150 m ahead of s = 50
    stops: []
  });
  const path = near.pool[0].path;
  path.route = -1;
  path.reset(near.graph.edges[0], 50, 10, () => 0.5);
  path.extend(140, () => 0.5);
  const before = near.rngState();
  assert.equal(near.bufferAhead(path, 200), true, '150 m from the buffer is inside the gate');
  assert.equal(near.rngState(), before, 'the look-ahead draws no tram random numbers');
  assert.equal(near.bufferAhead(path, 140), false, '140 m ahead stops short of it');

  const far = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [tram([0, 0, 400, 0])],
    stops: []
  });
  const farPath = far.pool[0].path;
  farPath.route = -1;
  farPath.reset(far.graph.edges[0], 50, 10, () => 0.5);
  farPath.extend(140, () => 0.5);
  assert.equal(far.bufferAhead(farPath, 200), false, 'a buffer 350 m away is outside the gate');

  // several short edges: the walk past the 140 m look-ahead must not draw either
  const walk = createTramSystem(inert(), {
    network: { nodes: [], edges: [] },
    rail: [70, 140, 210, 280].map((x) => tram([x - 70, 0, x, 0])),
    stops: []
  });
  const walkPath = walk.pool[0].path;
  walkPath.route = -1;
  walkPath.reset(walk.graph.edges[0], 50, 10, () => 0.5);
  walkPath.extend(140, () => 0.5);
  const walkBefore = walk.rngState();
  assert.equal(walk.bufferAhead(walkPath, 200), false, 'a buffer 230 m away is outside the gate');
  assert.equal(walk.rngState(), walkBefore, 'walking several edges draws no tram random numbers');
});
