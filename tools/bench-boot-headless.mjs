// Headless world build: per-phase timings (--gc: retained heap) and 24 output hashes (--hashes); --root picks a checkout.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { loadModule } = require(join(dirname(fileURLToPath(import.meta.url)), '../tests/helpers/module.cjs'));

function parseArgs(argv) {
  const args = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), hashes: false, gc: false, json: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = resolve(argv[++i]);
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--hashes') args.hashes = true;
    else if (a === '--gc') args.gc = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function makeRng(seed = 4242) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function hashValue(val) {
  const seen = new Map();
  let nextId = 0;
  const h = createHash('sha256');
  const stack = [val];
  const CLOSE_ARR = Symbol(']');
  const CLOSE_OBJ = Symbol('}');
  const RAW = Symbol('raw');
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === CLOSE_ARR) { h.update(']'); continue; }
    if (v === CLOSE_OBJ) { h.update('}'); continue; }
    if (v && typeof v === 'object' && v[RAW] !== undefined) { h.update(v[RAW]); continue; }
    if (v === null) { h.update('n;'); continue; }
    const t = typeof v;
    if (t === 'undefined') { h.update('u;'); continue; }
    if (t === 'boolean') { h.update(v ? 'b1;' : 'b0;'); continue; }
    if (t === 'number') { h.update(`d:${Object.is(v, -0) ? 0 : v};`); continue; }
    if (t === 'string') { h.update(`s${v.length}:${v};`); continue; }
    if (t === 'function') { h.update(`fn:${v.name || ''};`); continue; }
    if (t !== 'object') { h.update(`o:${String(v)};`); continue; }
    if (seen.has(v)) { h.update(`@${seen.get(v)};`); continue; }
    seen.set(v, nextId++);
    if (Array.isArray(v)) {
      h.update(`a${v.length}[`);
      stack.push(CLOSE_ARR);
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    if (ArrayBuffer.isView(v)) {
      h.update(`ta${v.constructor.name}:${v.byteLength}:`);
      h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      h.update(';');
      continue;
    }
    if (v instanceof Map) {
      h.update(`M${v.size}[`);
      stack.push(CLOSE_ARR);
      const entries = [...v.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      for (let i = entries.length - 1; i >= 0; i--) {
        stack.push(entries[i][1]);
        stack.push(entries[i][0]);
      }
      continue;
    }
    if (v instanceof Set) {
      h.update(`S${v.size}[`);
      stack.push(CLOSE_ARR);
      const items = [...v];
      for (let i = items.length - 1; i >= 0; i--) stack.push(items[i]);
      continue;
    }
    const keys = Object.keys(v).sort().filter((k) => !k.startsWith('_'));
    h.update(`{${keys.length}:`);
    stack.push(CLOSE_OBJ);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push(v[k]);
      stack.push({ [RAW]: `k${k.length}:${k}:` });
    }
  }
  return h.digest('hex');
}

async function main() {
  const args = parseArgs(process.argv);
  const root = args.root;
  const js = (file) => readFileSync(join(root, 'js', file), 'utf8');
  const quiet = { info() {}, log() {}, warn() {}, error() {} };

  const seededMath = Object.create(Math);
  seededMath.random = makeRng(4242);

  const G = {
    Math: seededMath, Object, Array, Set, Map, WeakMap, Number, Infinity, NaN, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int8Array, Int16Array, Float64Array, Uint8ClampedArray,
    Promise, String, Error, Boolean, Date, RegExp, TypeError, isFinite, parseFloat, parseInt, Reflect, Proxy,
    console: quiet, performance: { now: () => performance.now() }, document: inert()
  };

  const phases = {};
  const tStart = performance.now();

  let t0 = performance.now();
  const config = await import(pathToFileURL(join(root, 'js/city-config.js')).href);
  const { GEO } = await import(pathToFileURL(join(root, 'js/geodata.js')).href);
  phases.config = performance.now() - t0;

  const three = { 'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert() };

  // 1. Blocks
  t0 = performance.now();
  const blocksMod = loadModule(js('buildings.js'), {
    imports: {
      ...three, './balconies.js': inert(), './roofs.js': inert(), './tsl-materials.js': inert(),
      './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], railClearance: () => 100, railRectClear: () => true, sidewalkBlocks: [] }
    },
    globals: G, filename: 'buildings.js'
  });
  const cityBlocks = blocksMod.buildCityBlocks(inert());
  phases.blocks = performance.now() - t0;

  // 2. City Grid
  t0 = performance.now();
  const gridMod = loadModule(
    js('city-grid.js') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
    {
      imports: { ...three, './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': inert(), './trees.js': { SPECIES_CROWN_R: config.SPECIES_CROWN_R } },
      globals: G, filename: 'city-grid.js'
    }
  );
  const cityGrid = gridMod.buildCityGrid(inert(), {
    buildingFootprints: cityBlocks.footprintsByBlock,
    buildingColliders: cityBlocks.colliders
  });
  const gridSnap = gridMod.snapshot();
  phases.cityGrid = performance.now() - t0;

  // 3. Road network + Tram infra module
  const rnMod = loadModule(js('road-network.js'), {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: G, filename: 'road-network.js'
  });
  const tramInfraMod = loadModule(js('tram-infra.js'), {
    imports: { ...three, './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert() },
    globals: G, filename: 'tram-infra.js'
  });

  // 4. Street Details
  t0 = performance.now();
  let capturedStreetTrees = null;
  const sdMod = loadModule(js('street-details.js'), {
    imports: {
      ...three, './city-config.js': config, './road-network.js': rnMod, './tsl-materials.js': inert(),
      './trees.js': {
        SPECIES_CROWN_R: config.SPECIES_CROWN_R,
        createTreeField: (_scene, sites) => { capturedStreetTrees = sites; return { group: inert() }; }
      },
      './city-grid.js': {
        pavedPlazaRects: gridSnap.pavedPlazaRects,
        parkTreeSites: gridSnap.parkTreeSites,
        parkLampSites: gridSnap.parkLampSites,
        clearOfRails: gridMod.clearOfRails
      }
    },
    globals: G, filename: 'street-details.js'
  });
  const streetDetails = sdMod.buildStreetDetails(inert(), {
    buildingColliders: cityBlocks.colliders,
    grid: cityGrid,
    layoutTramInfrastructure: tramInfraMod.layoutTramInfrastructure
  });
  phases.streetDetails = performance.now() - t0;

  // 5. Pedestrian Routes + Traffic
  const pedRoutesMod = loadModule(
    js('pedestrian-routes.js').replace(
      'return { along, across, next, crosswalks, segments, segmentsNear, ways: wayTracks, waysNear };',
      'return { along, across, next, crosswalks, segments, segmentsNear, ways: wayTracks, waysNear, connections };'
    ),
    { imports: { './road-network.js': rnMod }, globals: G, filename: 'pedestrian-routes.js' }
  );
  const actorsMod = loadModule(js('actor-models.js'), {
    imports: { ...three, './tsl-materials.js': inert() },
    globals: G, filename: 'actor-models.js'
  });
  class PersonRig {
    constructor() { this.placed = false; this.feet = []; }
    update() {}
  }

  t0 = performance.now();
  const trafficMod = loadModule(js('traffic.js'), {
    imports: {
      ...three, './road-network.js': rnMod, './pedestrian-routes.js': pedRoutesMod, './city-config.js': config,
      './tsl-materials.js': inert(), './vehicle-lights.js': inert(),
      './actor-models.js': new Proxy(actorsMod, { get: (t, k) => (k in t && !/^(build|create)/.test(k) ? t[k] : inert()) }),
      './pedestrians.js': { PersonCrowd: function () { return inert(); }, PersonRig },
      './city-grid.js': { railClearance: gridMod.railClearance }
    },
    globals: G, filename: 'traffic.js'
  });
  const trafficSystem = trafficMod.createTrafficSystem(inert(), cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...cityBlocks.colliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.roadNetwork, cityBlocks.colliders, { population: 1 });
  phases.traffic = performance.now() - t0;

  // 6. Tram & Rail layouts
  t0 = performance.now();
  const tramLayout = streetDetails.tramLayout || tramInfraMod.layoutTramInfrastructure(trafficSystem.network);
  phases.tramLayout = performance.now() - t0;

  t0 = performance.now();
  const railLayout = tramInfraMod.layoutRailInfrastructure(trafficSystem.network);
  phases.railLayout = performance.now() - t0;

  // 7. Runtime signal heads + lazy pedestrian links
  t0 = performance.now();
  const signalSupports = [...tramLayout.poles, ...railLayout.masts];
  streetDetails.addRuntimeSignalHeads(trafficSystem.network, trafficSystem.pedestrianRoutes, signalSupports);
  phases.signalHeads = performance.now() - t0;

  // 8. Road paint
  t0 = performance.now();
  const capturedPaint = [];
  const paintThree = {
    ...three,
    'three/webgpu': new Proxy(function () {}, {
      get(_t, k) {
        if (k === 'BufferAttribute') return class BufferAttribute { constructor(arr, itemSize) { this.array = arr; this.itemSize = itemSize; } };
        if (k === 'BufferGeometry') return class BufferGeometry {
          constructor() { this.attrs = {}; this.idx = null; }
          setAttribute(n, a) { this.attrs[n] = a; }
          setIndex(i) { this.idx = i; }
          computeBoundingSphere() {}
          computeBoundingBox() {}
        };
        if (k === 'Mesh') return class Mesh { constructor(geom) { capturedPaint.push(geom); } };
        return inert();
      }
    })
  };
  const paintMod = loadModule(js('road-paint.js'), {
    imports: { ...paintThree, './road-network.js': rnMod, './tsl-materials.js': inert() },
    globals: G, filename: 'road-paint.js'
  });
  paintMod.buildRoadPaint(inert(), trafficSystem.network, trafficSystem.crosswalks, gridMod.railClearance);
  phases.paint = performance.now() - t0;

  // 9. Tram infrastructure
  t0 = performance.now();
  const tramInfra = tramInfraMod.buildTramInfrastructure(inert(), trafficSystem.network, { tram: tramLayout, rail: railLayout });
  phases.tramInfra = performance.now() - t0;

  // 10. Trams
  t0 = performance.now();
  const tramsMod = loadModule(js('trams.js'), {
    imports: {
      'three/webgpu': inert(), './geodata.js': { GEO }, './city-config.js': config,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.3 } } },
      './actor-models.js': inert(),
      './vehicle-lights.js': {
        HEADLIGHTS: { busIntensity: 900 },
        tramLightSpec: (len) => ({ headlight: [0.82, 0.9], zFront: len / 2 }),
        createVehicleHeadlight: () => inert(),
        placeVehicleHeadlight() {}
      }
    },
    globals: G, filename: 'trams.js'
  });
  const tramSystem = tramsMod.createTramSystem(inert(), {
    network: trafficSystem.network,
    stops: tramInfra.stops,
    traffic: trafficSystem
  });
  trafficSystem.setTrams(tramSystem);
  phases.trams = performance.now() - t0;

  const totalMs = performance.now() - tStart;

  let hashes = null;
  if (args.hashes) {
    const bootLinks = [];
    for (const seg of trafficSystem.pedestrianRoutes.segments()) {
      const ends = trafficSystem.pedestrianRoutes.connections.get(seg);
      if (ends) bootLinks.push([seg.id, ends]);
    }
    hashes = {
      'blocks.colliders': hashValue(cityBlocks.colliders),
      'blocks.footprintsByBlock': hashValue(cityBlocks.footprintsByBlock),
      'blocks.allBlocks': hashValue(cityBlocks.allBlocks),
      'grid.sidewalks': hashValue(cityGrid.sidewalks),
      'grid.footprints': hashValue(cityGrid.footprints),
      'grid.propColliders': hashValue(cityGrid.propColliders),
      'grid.parkTreeSites': hashValue(gridSnap.parkTreeSites),
      'grid.parkLampSites': hashValue(gridSnap.parkLampSites),
      'grid.pavedPlazaRects': hashValue(gridSnap.pavedPlazaRects),
      'grid.sidewalkBlocks': hashValue(gridSnap.sidewalkBlocks),
      'street.footprints': hashValue(streetDetails.footprints),
      'street.colliders': hashValue(streetDetails.colliders),
      'street.trees': hashValue(capturedStreetTrees),
      'street.audioSignals': hashValue(streetDetails.audioSignals),
      'network.final': hashValue(trafficSystem.network),
      'crosswalks': hashValue(trafficSystem.crosswalks),
      'pedestrian.links': hashValue(bootLinks),
      'tramLayout': hashValue(tramLayout),
      'railLayout': hashValue(railLayout),
      'paint': hashValue(capturedPaint),
      'tramInfra.colliders': hashValue(tramInfra.colliders),
      'tramInfra.stops': hashValue(tramInfra.stops),
      'tramInfra.railCorridor': hashValue(tramInfra.railCorridor),
      'tram.graph': hashValue(tramSystem.graph || tramSystem)
    };
  }

  let mem = null;
  if (args.gc && typeof global.gc === 'function') {
    global.gc();
    mem = process.memoryUsage();
  }

  const out = { root, totalMs, phases, hashes, mem };
  if (args.json) {
    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(args.json, JSON.stringify(out, null, 2));
  } else {
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
