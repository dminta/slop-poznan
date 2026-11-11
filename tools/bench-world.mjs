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
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], railClearance: () => 100, sidewalkBlocks: [] }
    },
    globals: { ...G, document: stub }, filename: 'buildings.js'
  });
  buildingColliders = buildCityBlocks(stub).colliders;
  return buildingColliders;
}

// The production route factory keeps its public shape, but an audit needs the lazy `links` and the connector
// candidates behind an empty landing. Source-sliced like the route tests (docs/testing.md). `diagnoseFallback` mirrors
// `fallbackPaths`' acceptance test and names the first rejected rule, so an audit can explain the isolated landings.
let pedestrianRoutesModule = null;
function loadPedestrianRoutes(rn) {
  if (pedestrianRoutesModule) return pedestrianRoutesModule;
  if (!rn) throw new Error('loadPedestrianRoutes: call buildWorld first or pass the road-network module');
  const diagnose = `
  function walkWhy(a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
      if (!walkable(x - 0.4, x + 0.4, z - 0.4, z + 0.4)) return 'walk';
    }
    return null;
  }
  // The exact clear body: variable 1 m steps, and walkable tested over the box swept between consecutive samples.
  // A plain 0.5 m point test can miss a narrow footprint and report a same-block candidate as accepted.
  function clearWhy(a, b, block) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    let x = a.x, z = a.z;
    for (let i = 0; i <= steps; i++) {
      const nx = a.x + (b.x - a.x) * i / steps, nz = a.z + (b.z - a.z) * i / steps;
      if (!walkable(Math.min(x, nx) - 0.4, Math.max(x, nx) + 0.4,
        Math.min(z, nz) - 0.4, Math.max(z, nz) + 0.4)) return 'walk';
      if (blockAt(nx, nz) !== block) return 'block';
      x = nx; z = nz;
    }
    return null;
  }
  function hazardWhy(a, b) {
    if (!clearOfStreets(a, b)) return 'lane';
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
      if (railClearance && railClearance(x, z, RAIL_KEEP) < RAIL_KEEP) return 'rail';
      if (hitsBuilding(x, z)) return 'building';
      const blk = blockAt(x, z);
      if (blk && inLot(x, z, blk)) return 'lot';
    }
    return null;
  }
  // Mirror fallbackPaths' two loops: the direct loop owns ports within DIRECT_MAX (and requires a target block);
  // the long loop owns the rest up to FALLBACK_MAX and has no 16 m cross-block limit. clearGap already contains
  // clearHazards, so the walkable reason is tested first and the hazard reason (lane/rail/building/lot) next.
  function candidateWhy(a, b, block, direct) {
    const targetBlock = blockAt(b.x, b.z);
    if (direct) {
      if (!targetBlock) return 'noBlock';
      if (targetBlock === block) {
        const why = clearWhy(a, b, block);
        if (why) return why;
      } else if (!clearGap(a, b)) {
        return walkWhy(a, b) || hazardWhy(a, b) || 'gap';
      }
    } else if (!clearGap(a, b)) {
      return walkWhy(a, b) || hazardWhy(a, b) || 'gap';
    }
    if (hazardWhy(a, b)) return hazardWhy(a, b);
    return withinBlockEdge(a, b, block, direct ? DIRECT_CORRIDOR : FALLBACK_CORRIDOR) ? 'ok' : 'corridor';
  }
  function nearWhy(a, b, block, sameBlock) {
    if (sameBlock) {
      const why = clearWhy(a, b, block);
      if (why) return why;
      if (!withinBlockEdge(a, b, block, FALLBACK_CORRIDOR)) return 'corridor';
    } else if (!clearGap(a, b)) {
      return walkWhy(a, b) || hazardWhy(a, b) || 'gap';
    }
    if (hazardWhy(a, b)) return hazardWhy(a, b);
    return withinBlockEdge(a, b, block, FALLBACK_CORRIDOR) ? 'ok' : 'corridor';
  }
  function diagnoseFallback(track, dir) {
    const end = dir > 0 ? 1 : 0, a = point(track, end), n = end ? track.to : track.from;
    const block = blockAt(a.x, a.z), out = { a, block: !!block, candidates: [], near: [] };
    if (!block || !n) return out;
    const candidates = ports(n).concat((islandPorts.get(block) || []).filter((p) => p.track.node !== n));
    for (const port of candidates) {
      const next = port.track;
      const b = point(next, port.end), distance = Math.hypot(b.x - a.x, b.z - a.z);
      const targetBlock = blockAt(b.x, b.z), r = { x: +b.x.toFixed(1), z: +b.z.toFixed(1),
        distance: +distance.toFixed(1), targetBlock: !!targetBlock, sameBlock: targetBlock === block };
      if (next === track) r.why = 'self';
      else if (track.arm && next.arm === track.arm) r.why = 'sibling';
      else if (distance <= 0.01) r.why = 'zero';
      else if (distance > FALLBACK_MAX) r.why = 'length';
      else r.why = candidateWhy(a, b, block, distance <= DIRECT_MAX);
      out.candidates.push(r);
    }
    const seen = new Set(), near = [];
    const cells = indexStreets();
    const ix0 = Math.floor((a.x - FALLBACK_MAX) / 64), ix1 = Math.floor((a.x + FALLBACK_MAX) / 64);
    const iz0 = Math.floor((a.z - FALLBACK_MAX) / 64), iz1 = Math.floor((a.z + FALLBACK_MAX) / 64);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      for (const e of cells.get(ix * 100000 + iz) || []) {
        if (seen.has(e)) continue;
        seen.add(e);
        for (const q of along(e)) {
          if (q === track || !q.edge) continue;
          const proj = Math.max(0, Math.min(q.len, (a.x - q.ax) * q.ux + (a.z - q.az) * q.uz));
          if (proj <= 0.01 || proj >= q.len - 0.01) continue;
          const x = q.ax + q.ux * proj, z = q.az + q.uz * proj;
          const distance = Math.hypot(a.x - x, a.z - z);
          if (distance > FALLBACK_MAX) continue;
          const targetBlock = blockAt(x, z);
          if (!targetBlock) continue;
          near.push({ q, x, z, distance, targetBlock });
        }
      }
    }
    near.sort((p, q) => p.distance - q.distance);
    for (const c of near.slice(0, 8)) {
      const r = { x: +c.x.toFixed(1), z: +c.z.toFixed(1), distance: +c.distance.toFixed(1),
        sameBlock: c.targetBlock === block };
      r.why = nearWhy(a, { x: c.x, z: c.z }, block, c.targetBlock === block);
      out.near.push(r);
    }
    return out;
  }
  `;
  pedestrianRoutesModule = loadModule(js('pedestrian-routes.js')
    .replace('return { along, across, next, crosswalks, segments, segmentsNear, ways: wayTracks, waysNear };',
      `${diagnose}\n  return { along, across, next, crosswalks, segments, segmentsNear, ways: wayTracks, waysNear, ` +
      'baseLinks, links, fallbackPaths, curbStepPaths, ports, diagnoseFallback };')
  , { imports: { './road-network.js': rn }, globals: G, filename: 'pedestrian-routes.js' });
  return pedestrianRoutesModule;
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
  const routes = loadPedestrianRoutes(rn);
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
    const budget = 'let pedBudget = jump ? pedPopulation : 6;';
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
  return { traffic, trams, network: traffic.network, railClearance: grid.railClearance };
}

export { buildWorld, loadBuildingColliders, loadPedestrianRoutes };
