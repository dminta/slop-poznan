const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

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

let config;
let GEO;
let net;
let pedRoutes;
let railInfra;
let tramInfraMod;

test.before(async () => {
  config = await import('../js/city-config.js');
  ({ GEO } = await import('../js/geodata.js'));

  const rnSource = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
  const { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH } = loadModule(rnSource, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, log() {}, warn() {} } },
    filename: 'road-network.js'
  });
  net = buildRoadNetwork([], []);

  const prSource = readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8');
  const { createPedestrianRoutes } = loadModule(prSource, {
    imports: { './road-network.js': { CROSSWALK, CROSSWALK_REACH } },
    globals: { console: { info() {} } },
    filename: 'pedestrian-routes.js'
  });
  pedRoutes = createPedestrianRoutes(net, config.blockAt);

  const tiSource = readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(), 'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
  };
  tramInfraMod = loadModule(tiSource, {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { Math, Object, Array, Set, Map, Number, Float32Array, Float64Array, console: { info() {}, warn() {}, log() {} }, document: inert() },
    filename: 'tram-infra.js'
  });
  railInfra = tramInfraMod.layoutRailInfrastructure(net);
});

test('UNDERPASS_SIDEWALKS exports 44 continuous sidewalk strips under railway bridges', () => {
  assert.ok(config.UNDERPASS_SIDEWALKS, 'UNDERPASS_SIDEWALKS is exported');
  assert.equal(config.UNDERPASS_SIDEWALKS.length, 44, 'generates 44 unique underpass sidewalk strips');
  for (const s of config.UNDERPASS_SIDEWALKS) {
    assert.equal(s.poly.length, 4, 'each sidewalk strip is a 4-point polygon');
    assert.equal(s.underpass, true);
    assert.equal(s.median, false);
    assert.ok(s.area > 20, `strip ${s.id} has substantial area`);
  }
});

test('no kept railway track piece collides with any underpass sidewalk', () => {
  let collisions = 0;
  for (const piece of railInfra.pieces) {
    for (let t = 0; t <= 1; t += 0.25) {
      const px = piece.ax + (piece.bx - piece.ax) * t;
      const pz = piece.az + (piece.bz - piece.az) * t;
      const b = config.blockAt(px, pz);
      if (b?.underpass) collisions++;
    }
  }
  assert.equal(collisions, 0, 'zero collisions between kept railway tracks and underpass sidewalks');
});

test('pedestrian routes cross through rail underpass corridors', () => {
  // Key underpass edges across Poznań
  const sampleEdges = [519, 6631, 6549, 3440, 4457, 5779, 7589];
  for (const id of sampleEdges) {
    const edge = net.edges.find((e) => e.id === id);
    assert.ok(edge, `edge ${id} exists in road network`);
    const tracks = pedRoutes.along(edge);
    assert.ok(tracks.length >= 2, `edge ${id} has pedestrian tracks (found ${tracks.length})`);
    
    // Test navigation connectivity through the underpass
    const t0 = tracks[0];
    const pathForward = pedRoutes.next(t0, 1, t0.to.x + 40, t0.to.z + 40);
    const pathBackward = pedRoutes.next(t0, -1, t0.from.x - 40, t0.from.z - 40);
    assert.ok(pathForward && pathForward.length > 0, `edge ${id} connects forward across underpass`);
    assert.ok(pathBackward && pathBackward.length > 0, `edge ${id} connects backward across underpass`);
  }
});

test('railway viaducts bridge cut tracks over roadways with vertical clearance', () => {
  assert.ok(Array.isArray(railInfra.viaducts), 'viaducts array is exported from rail layout');
  assert.ok(railInfra.viaducts.length >= 40, `${railInfra.viaducts.length} viaduct spans (expected >= 40)`);

  for (const v of railInfra.viaducts) {
    assert.ok(v.spanLen >= 10 && v.spanLen <= 120, `valid viaduct span length ${v.spanLen.toFixed(1)} m`);
    assert.ok(v.yClearance >= 4.8, `clearance ${v.yClearance} m >= 4.8 m`);
    assert.ok(v.deckY >= 5.14, `deck height ${v.deckY} m >= 5.14 m`);
    assert.ok(v.pieces.length >= 1, `viaduct has ${v.pieces.length} track pieces`);
    if (v.hasTram) {
      assert.ok(v.yClearance >= 6.0, `viaduct over tram has ${v.yClearance} m >= 6.0 m clearance`);
    }
  }

  // Hetmańska Górczyn line underpass
  const HX = -1855, HZ = 2482;
  const hetViaducts = railInfra.viaducts.filter((v) => Math.hypot(v.mx - HX, v.mz - HZ) < 60);
  assert.ok(hetViaducts.length >= 4, `Hetmańska has ${hetViaducts.length} viaduct spans across the underpass`);
  for (const hv of hetViaducts) {
    assert.equal(hv.hasTram, true, 'Hetmańska viaduct spans detect tram corridor');
    assert.equal(hv.yClearance, 6.0, 'Hetmańska viaduct vertical clearance is 6.0 m for tram catenary');
  }
});

test('railway viaduct decks generate overhead colliders leaving ground roadways unobstructed', () => {
  const infra = tramInfraMod.buildTramInfrastructure(inert(), net);
  assert.ok(infra.colliders.length > 0, 'colliders generated');

  const overheadColliders = infra.colliders.filter((c) => (c.minY ?? 0) >= 4.8);
  assert.ok(overheadColliders.length >= 100, `${overheadColliders.length} overhead viaduct colliders (expected >= 100)`);

  // Verify that ground-level entities (y <= 2.0 m) have 0 collisions with viaduct deck spans
  const HX = -1855, HZ = 2482;
  const hetOverhead = overheadColliders.filter((c) => Math.hypot((c.minX + c.maxX) / 2 - HX, (c.minZ + c.maxZ) / 2 - HZ) < 50);
  assert.ok(hetOverhead.length >= 10, `${hetOverhead.length} overhead colliders at Hetmańska`);

  for (const c of hetOverhead) {
    assert.ok(c.minY >= 6.0, `Hetmańska deck collider bottom is at ${c.minY} m >= 6.0 m`);
    // A car or pedestrian at ground level (y in [0, 2.0]) must never collide
    const groundEntityTop = 2.0;
    assert.ok(groundEntityTop <= c.minY, 'ground entity passes completely underneath the viaduct deck');
  }

  // Verify abutment end walls have protective height up to deck level
  const hetAbutments = infra.colliders.filter((c) => (c.minY ?? 0) === 0 && c.maxY >= 5.15 &&
    Math.hypot((c.minX + c.maxX) / 2 - HX, (c.minZ + c.maxZ) / 2 - HZ) < 50);
  assert.ok(hetAbutments.length >= 4, `${hetAbutments.length} abutment colliders at Hetmańska`);
});

test('railway track approach ramps transition smoothly into viaduct decks without vertical step', () => {
  let transitionsChecked = 0;
  for (const v of railInfra.viaducts) {
    const entry = railInfra.pieces.find((p) => p.railIndex === v.railIndex && Math.hypot(p.bx - v.ax, p.bz - v.az) < 0.1);
    const exit = railInfra.pieces.find((p) => p.railIndex === v.railIndex && Math.hypot(p.ax - v.bx, p.az - v.bz) < 0.1);
    if (entry) {
      assert.ok(Math.abs(entry.yB - v.deckY) < 0.001,
        `entry piece yB (${entry.yB.toFixed(3)}) matches deckY (${v.deckY.toFixed(3)}) on track ${v.railIndex}`);
      transitionsChecked++;
    }
    if (exit) {
      assert.ok(Math.abs(exit.yA - v.deckY) < 0.001,
        `exit piece yA (${exit.yA.toFixed(3)}) matches deckY (${v.deckY.toFixed(3)}) on track ${v.railIndex}`);
      transitionsChecked++;
    }
  }
  assert.ok(transitionsChecked >= 70, `checked ${transitionsChecked} abutment track transitions (expected >= 70)`);
});

test('railway ramp slope does not exceed the allowed limit of 6%', () => {
  let elevatedCount = 0;
  let maxSlope = 0;
  for (const pc of railInfra.pieces) {
    const len = Math.hypot(pc.bx - pc.ax, pc.bz - pc.az);
    if (len < 0.01) continue;
    const slope = Math.abs(pc.yB - pc.yA) / len;
    if (slope > maxSlope) maxSlope = slope;
    assert.ok(slope < 0.06, `piece on track ${pc.railIndex} has slope ${(slope * 100).toFixed(2)}% < 6%`);
    if (pc.yA > pc.ground + 0.05 || pc.yB > pc.ground + 0.05) elevatedCount++;
  }
  assert.ok(elevatedCount > 1000, `at least 1000 track pieces are elevated on approach ramps (found ${elevatedCount})`);
  assert.ok(maxSlope < 0.06, `maximum ramp slope ${(maxSlope * 100).toFixed(2)}% < 6.0%`);
});

