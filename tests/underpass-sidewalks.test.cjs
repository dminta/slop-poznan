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
  const tramInfraModule = loadModule(tiSource, {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} } },
    filename: 'tram-infra.js'
  });
  railInfra = tramInfraModule.layoutRailInfrastructure(net);
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
