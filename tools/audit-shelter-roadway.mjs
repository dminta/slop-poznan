// Headless audit: every tram stop shelter's real roof/advert footprint against the carriageway, the tram tracks and
// the raised sidewalk it stands on. The Rondo Rataje report (a shelter reaching the carriageway) came from the fixed
// anchor point at the middle of a platform that runs from a sidewalk into the tram/bus strip.
//
//   node tools/audit-shelter-roadway.mjs [--before] [--json] [--top N] [--near x,z,r]
//
// --before loads js/tram-infra.js from de70d64 (the pre-fix placement) so the count can be recorded.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const before = args.includes('--before');
const topIndex = args.indexOf('--top');
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 20;
const nearIndex = args.indexOf('--near');
const near = nearIndex >= 0 ? args[nearIndex + 1].split(',').map(Number) : null;

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals: { console: { info() {}, warn() {}, log() {} } },
  filename: 'road-network.js'
});
const grid = loadModule(source('city-grid'), {
  imports: {
    'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
    './geodata.js': { GEO }, './tsl-materials.js': inert()
  },
  filename: 'city-grid.js'
});
const details = loadModule(source('street-details'), {
  imports: {
    'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config,
    './road-network.js': {
      buildRoadNetwork: road.buildRoadNetwork, CROSSWALK: road.CROSSWALK,
      CROSSWALK_REACH: road.CROSSWALK_REACH, STOP_SETBACK: road.STOP_SETBACK
    },
    './tsl-materials.js': inert(), './trees.js': { createTreeField: () => ({ group: inert() }) },
    './city-grid.js': {
      pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [],
      clearOfRails: grid.clearOfRails
    }
  },
  globals: {
    console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
    document: inert()
  },
  filename: 'street-details.js'
});
const { footprints } = details.buildStreetDetails(inert());
const network = road.buildRoadNetwork([], footprints);
const tramSource = before
  ? execFileSync('git', ['show', 'de70d64:js/tram-infra.js'], { cwd: root, encoding: 'utf8' })
  : source('tram-infra');
const { layoutTramInfrastructure } = loadModule(tramSource, {
  imports: {
    'three/webgpu': inert(), 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert()
  },
  globals: {
    Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol, Float32Array, Float64Array, Promise, String, Error,
    document: inert(), console: { info() {}, warn() {}, log() {} }
  },
  filename: 'tram-infra.js'
});
const layout = layoutTramInfrastructure(network);
const TRACK_KEEP = 1.75;
const LANE_HALF = 1.8;
const TRAM_STRIP_HALF = 3.25;
const SHELTER_HALF_LEN = 2.3;
const SHELTER_HALF_DEPTH = 0.8;

function pointAt(tr, s) {
  let lo = 0, hi = tr.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const L = tr.cum[hi] - tr.cum[lo] || 1, t = (s - tr.cum[lo]) / L;
  return {
    x: tr.p[2 * lo] + (tr.p[2 * hi] - tr.p[2 * lo]) * t,
    z: tr.p[2 * lo + 1] + (tr.p[2 * hi + 1] - tr.p[2 * lo + 1]) * t,
    dx: (tr.p[2 * hi] - tr.p[2 * lo]) / L,
    dz: (tr.p[2 * hi + 1] - tr.p[2 * lo + 1]) / L
  };
}

function platformMixed(stop) {
  if (!stop.platform) return false;
  const tr = layout.tracks.find((t) => t.railIndex === stop.railIndex);
  let blocks = 0, samples = 0;
  for (let s = stop.platform.s0; s <= stop.platform.s1 + 1e-6; s += 1) {
    const p = pointAt(tr, s);
    for (const o of [stop.platform.o0, (stop.platform.o0 + stop.platform.o1) / 2, stop.platform.o1]) {
      samples++;
      if (config.blockAt(p.x - p.dz * o, p.z + p.dx * o)) blocks++;
    }
  }
  return blocks > 0.05 * samples && blocks < 0.95 * samples;
}

const shelterRect = (x, z, yaw, len) => {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x, z, hx: SHELTER_HALF_LEN * len / 4.4, hz: SHELTER_HALF_DEPTH, ux: cs, uz: -sn, vx: sn, vz: cs };
};
const samples = (a, step = 0.4) => {
  const out = [];
  const nx = Math.max(1, Math.ceil(2 * a.hx / step));
  const nz = Math.max(1, Math.ceil(2 * a.hz / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = -a.hx + 2 * a.hx * i / nx;
      const lz = -a.hz + 2 * a.hz * j / nz;
      out.push([a.x + a.ux * lx + a.vx * lz, a.z + a.uz * lx + a.vz * lz]);
    }
  }
  return out;
};
const overlap = (a, b) => {
  let min = Infinity;
  for (const r of [a, b]) {
    for (const [ax, az] of [[r.ux, r.uz], [r.vx, r.vz]]) {
      const dist = Math.abs((a.x - b.x) * ax + (a.z - b.z) * az);
      const radius = (q) => q.hx * Math.abs(q.ux * ax + q.uz * az) + q.hz * Math.abs(q.vx * ax + q.vz * az);
      min = Math.min(min, radius(a) + radius(b) - dist);
    }
  }
  return min;
};
function roadRect(e, stripAware) {
  let half = e.half, centre = 0;
  if (stripAware && e.strip) {
    half -= TRAM_STRIP_HALF;
    centre = -e.strip * TRAM_STRIP_HALF;
  }
  return {
    x: e.x0 + e.dx * e.span / 2 + e.rx * centre,
    z: e.z0 + e.dz * e.span / 2 + e.rz * centre,
    hx: e.span / 2, hz: half, ux: e.dx, uz: e.dz, vx: e.rx, vz: e.rz
  };
}
const roadEdges = network.edges;
const roadDepth = (a, stripAware) => {
  let best = -Infinity;
  for (const e of roadEdges) {
    if (Math.abs(e.x0 - a.x) > e.span + 20 && Math.abs(e.x0 + e.dx * e.span - a.x) > e.span + 20 &&
      Math.abs(e.z0 - a.z) > e.span + 20 && Math.abs(e.z0 + e.dz * e.span - a.z) > e.span + 20) continue;
    const d = overlap(a, roadRect(e, stripAware));
    if (d > best) best = d;
  }
  return best;
};

const rows = [];
let stopCount = 0, shelterCount = 0;
for (const stop of layout.stops) {
  if (near && Math.hypot(stop.x - near[0], stop.z - near[1]) > (near[2] || 250)) continue;
  stopCount++;
  if (!stop.shelter) continue;
  shelterCount++;
  const shelter = stop.shelter;
  const rect = shelterRect(shelter.x, shelter.z, shelter.yaw, shelter.len);
  const pts = samples(rect);
  let lane = Infinity, track = Infinity, blockMiss = 0;
  for (const [x, z] of pts) {
    lane = Math.min(lane, layout.laneDist(x, z, 6));
    track = Math.min(track, layout.trackDist(x, z, 4));
    if (!config.blockAt(x, z)) blockMiss++;
  }
  const road = roadDepth(rect, true);
  const fullRoad = roadDepth(rect, false);
  const mixed = platformMixed(stop);
  const laneDeficit = Math.max(0, LANE_HALF - lane);
  const trackDeficit = Math.max(0, TRACK_KEEP - track);
  const reasons = [];
  if (laneDeficit > 1e-6) reasons.push('lane');
  if (trackDeficit > 1e-6) reasons.push('track');
  if (road > 0) reasons.push('roadway');
  if (stop.kind === 'curb' && blockMiss > 0) reasons.push('curb');
  if (mixed && blockMiss > 0) reasons.push('mixed-platform');
  if (!reasons.length) continue;
  const depth = Math.max(road, mixed ? fullRoad : 0, laneDeficit, trackDeficit, blockMiss > 0 ? 0.05 : 0);
  rows.push({
    name: stop.name, x: +stop.x.toFixed(1), z: +stop.z.toFixed(1), kind: stop.kind,
    shelter: [+shelter.x.toFixed(1), +shelter.z.toFixed(1)],
    depth: +depth.toFixed(2), reasons,
    lane: +lane.toFixed(2), track: +track.toFixed(2), roadway: +road.toFixed(2), fullRoadway: +fullRoad.toFixed(2),
    blockMiss, mixed
  });
}
rows.sort((a, b) => b.depth - a.depth);
const summary = {
  label: before ? 'before' : 'after',
  stops: stopCount,
  shelters: shelterCount,
  overlaps: rows.length,
  moved: layout.sheltersMoved?.length ?? null,
  dropped: layout.sheltersDropped?.length ?? null,
  movedShelters: layout.sheltersMoved?.map((s) => ({
    name: s.name, x: +s.x.toFixed(1), z: +s.z.toFixed(1),
    shelter: [+s.shelterX.toFixed(1), +s.shelterZ.toFixed(1)]
  })) ?? null,
  droppedShelters: layout.sheltersDropped?.map((s) => ({
    name: s.name, x: +s.x.toFixed(1), z: +s.z.toFixed(1)
  })) ?? null,
  rows: rows.slice(0, top)
};
if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`=== Tram shelter / carriageway audit (${summary.label}) ===`);
  console.log(`${summary.stops} stops, ${summary.shelters} shelters, ${summary.overlaps} overlapping`);
  if (summary.moved !== null) console.log(`${summary.moved} shelters moved, ${summary.dropped} dropped by the rule`);
  for (const r of summary.rows) {
    console.log(`  ${r.depth.toFixed(2)} m  ${r.name} (${r.x}, ${r.z}) ${r.kind}  ` +
      `shelter ${r.shelter[0]}, ${r.shelter[1]}  [${r.reasons.join(', ')}]  ` +
      `lane ${r.lane.toFixed(2)}, track ${r.track.toFixed(2)}, road ${r.roadway.toFixed(2)}, block miss ${r.blockMiss}`);
  }
}
if (rows.length) process.exitCode = 1;
