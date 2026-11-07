// Shared headless world for traffic and tram benchmarks. Rendering objects are inert.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');

// A stand-in for every three.js / TSL object: any property, call or `new` gives another one
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_t, key, value) {
      store[key] = value;
      return true;
    },
    apply: () => inert(),
    construct: () => inert()
  });
}

const quiet = { info() {}, log() {}, warn() {} };
const G = {
  Math, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol, Float32Array, Uint8Array, Uint16Array,
  Uint32Array, Int32Array, Int8Array, Int16Array, Float64Array, Uint8ClampedArray, Promise, String, Error,
  Boolean, Date,
  RegExp, TypeError, isFinite, parseFloat, parseInt, Reflect, Proxy, console: quiet
};
const js = (file) => readFileSync(join(ROOT, 'js', file), 'utf8');
const config = await import(pathToFileURL(join(ROOT, 'js/city-config.js')).href);
const { GEO } = await import(pathToFileURL(join(ROOT, 'js/geodata.js')).href);

// The benchmark still omits the rendered city, but the building colliders are cheap to generate on their own (the
// block generator reads only geodata and config) and the pedestrian route builder needs them to keep fallback
// connectors out of walls. Landmark and bridge colliders stay omitted: they add little at this scale and would pull
// the whole landmark/bridge builders into every benchmark process. Built once per process and shared by all districts.
let buildingColliders = null;
function loadBuildingColliders() {
  if (buildingColliders) return buildingColliders;
  const stub = inert();
  const { buildCityBlocks } = loadModule(js('buildings.js'), {
    imports: {
      'three/webgpu': inert(), 'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(),
      './balconies.js': inert(), './roofs.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
    },
    globals: { ...G, document: stub }, filename: 'buildings.js'
  });
  buildingColliders = buildCityBlocks(stub).colliders;
  return buildingColliders;
}

// The furnished network as main.js builds it, less the buildings (none stands in a lane) and the curb rectangles
function buildWorld({ noPeds = false, noTrams = false, noSignals = false, tramSeed = 1922 } = {}) {
  const rn = loadModule(js('road-network.js'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } }, globals: G, filename: 'road-network.js'
  });
  const three = { 'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert() };
  const grid = loadModule(js('city-grid.js'), {
    imports: { ...three, './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert() },
    globals: G, filename: 'city-grid.js'
  });
  const { buildStreetDetails } = loadModule(js('street-details.js'), {
    imports: {
      ...three, './city-config.js': config, './road-network.js': rn, './tsl-materials.js': inert(),
      './trees.js': { createTreeField: () => ({ group: inert() }) },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails: grid.clearOfRails }
    },
    globals: { ...G, document: inert() }, filename: 'street-details.js'
  });
  const { footprints, roadNetwork } = buildStreetDetails(inert());
  const routes = loadModule(js('pedestrian-routes.js'), { imports: { './road-network.js': rn }, globals: G });
  const actors = loadModule(js('actor-models.js'), {
    imports: { ...three, './tsl-materials.js': inert() },
    globals: { ...G, document: inert() }, filename: 'actor-models.js'
  });
  class PersonRig {
    constructor() {
      this.placed = false;
      this.feet = [];
    }
    update() {}
  }
  let trafficSource = js('traffic.js');
  if (noPeds) {
    // an experiment: no pedestrians at all (none is ever placed)
    const budget = 'let pedBudget = jump ? NUM_PEDS : 6;';
    if (!trafficSource.includes(budget)) throw new Error(`--no-peds: traffic.js no longer has "${budget}"`);
    trafficSource = trafficSource.replace(budget, 'let pedBudget = 0;');
  }
  if (noSignals) {
    // an experiment: every signal green for every road (crossing traffic still keeps out of an occupied box)
    const phase = "const phaseOf = (e) => (e.axisIndex === 0 ? e.to.signalTiming.phase0 : e.to.signalTiming.phase1);";
    if (!trafficSource.includes(phase)) {
      throw new Error('--no-signals: traffic.js no longer has the cached phaseOf helper');
    }
    trafficSource = trafficSource.replace(phase, "const phaseOf = () => 'green';");
  }
  const { createTrafficSystem } = loadModule(trafficSource, {
    imports: {
      ...three, './road-network.js': rn, './pedestrian-routes.js': routes, './city-config.js': config,
      './tsl-materials.js': inert(), './vehicle-lights.js': inert(),
      // only the pure helpers (sizes, plates); the builders and materials are stand-ins
      './actor-models.js': new Proxy(actors, {
        get: (t, k) => (k in t && !/^(build|create)/.test(k) ? t[k] : inert())
      }),
      './pedestrians.js': { PersonCrowd: function () { return inert(); }, PersonRig }, './city-grid.js': grid
    },
    globals: { ...G, performance: { now: () => 0 }, document: inert() }, filename: 'traffic.js'
  });
  const traffic = createTrafficSystem(inert(), [], footprints, roadNetwork, loadBuildingColliders());
  const { layoutTramInfrastructure } = loadModule(js('tram-infra.js'), {
    imports: { ...three, './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert() },
    globals: G, filename: 'tram-infra.js'
  });
  const { stops } = layoutTramInfrastructure(traffic.network);
  const { createTramSystem } = loadModule(js('trams.js'), {
    imports: {
      'three/webgpu': inert(), './geodata.js': { GEO }, './city-config.js': config,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.3 } } }, './actor-models.js': inert(),
      './vehicle-lights.js': {
        HEADLIGHTS: { busIntensity: 900 }, tramLightSpec: (len) => ({ headlight: [0.82, 0.9], zFront: len / 2 }),
        createVehicleHeadlight: () => inert(), placeVehicleHeadlight() {}
      }
    },
    globals: G, filename: 'trams.js'
  });
  const trams = createTramSystem(inert(), { network: traffic.network, stops, traffic, seed: tramSeed });
  if (!noTrams) traffic.setTrams(trams);
  return { traffic, trams, network: traffic.network };
}

export { buildWorld };
