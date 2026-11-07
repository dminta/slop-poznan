const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = (name) => readFileSync(join(__dirname, '../js', `${name}.js`), 'utf8');

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
    apply: () => inert(), construct: () => inert()
  });
}

const G = {
  Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol, Float32Array, Uint8Array, Uint16Array,
  Uint32Array, Int32Array, Int8Array, Int16Array, Float64Array, Uint8ClampedArray, Promise, String, Error,
  Boolean, Date, RegExp, TypeError, isFinite, parseFloat, parseInt, Reflect, Proxy,
  console: { info() {}, log() {}, warn() {} }
};

test('traffic hands the real building colliders to the pedestrian route builder', async () => {
  const config = await import('../js/city-config.js');
  const stub = inert();
  const three = { 'three/webgpu': stub, 'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub };
  const actors = loadModule(source('actor-models'), {
    imports: { ...three, './tsl-materials.js': stub },
    globals: { ...G, document: stub }, filename: 'actor-models.js'
  });
  const actorStubs = new Proxy(actors, {
    get: (target, key) => (key in target && !/^(build|create)/.test(key) ? target[key] : inert())
  });
  let received = null;
  const pedestrianRoutes = {
    createPedestrianRoutes: (...args) => {
      received = args;
      return { along: () => [], across: () => [], next: () => null, crosswalks: [], segments: () => [],
        segmentsNear: () => [] };
    }
  };
  class PersonRig {
    constructor() {
      this.placed = false;
      this.feet = [];
    }
    update() {}
  }
  const { createTrafficSystem } = loadModule(source('traffic'), {
    imports: {
      ...three,
      './road-network.js': { buildRoadNetwork: () => ({}), CROSSWALK: 4.3 },
      './pedestrian-routes.js': pedestrianRoutes,
      './city-config.js': config,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0 } }, createContactShadowMaterial: () => ({}) },
      './vehicle-lights.js': { HEADLIGHTS: {}, createVehicleHeadlight: () => inert(), placeVehicleHeadlight() {} },
      './actor-models.js': actorStubs,
      './pedestrians.js': { PersonCrowd: function () { return { meshes: [] }; }, PersonRig },
      './city-grid.js': { railClearance: () => Infinity }
    },
    globals: { ...G, performance: { now: () => 0 }, document: stub }, filename: 'traffic.js'
  });
  const network = { nodes: [], edges: [], connector: () => null, curvePoint: () => ({ x: 0, z: 0 }) };
  const buildingColliders = [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: 0, maxY: 5 }];
  const system = createTrafficSystem(stub, [], [], network, buildingColliders);
  assert.equal(received[0], network, 'the supplied network reaches the routes');
  assert.equal(received[3], buildingColliders, 'the building colliders reach the routes');
  assert.equal(system.pedestrianRoutes.crosswalks.length, 0);
});
