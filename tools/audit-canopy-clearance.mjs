// Audit tall prop footprints and tram support segments against every mapped canopy deck.
// Trees are treated as tall; the audit tests trunks rather than crowns. Run with --json for all hits.
// Railway cantilevers, contact wires, lamp-arm intersections and signal heads outside their pole footprint are omitted.
//   node tools/audit-canopy-clearance.mjs [--json]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elemRings, ringArea } from './geo-util.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

const globals = {
  console: { info() {}, log() {}, warn() {} },
  Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
  Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array,
  Promise, String, Error, document: inert(), performance: globalThis.performance
};

const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const tslStub = inert();

const { THREE: mockTHREE } = require('../tests/helpers/three-stub.cjs');
const { Group } = mockTHREE;

const threeStub = mockTHREE;
const inertThree = inert();
const materialsStub = new Proxy({
  createPreWarBuildingMaterial: () => ({}),
  createCurtainWallMaterial: () => ({}),
  createFacadeBoxes: () => new Group()
}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => ({});
  }
});

const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals, filename: 'road-network.js'
});
const pedRoutesMod = loadModule(source('pedestrian-routes'), {
  imports: { './city-config.js': config, './road-network.js': road },
  globals, filename: 'pedestrian-routes.js'
});
const kit = loadModule(source('landmark-kit'), {
  imports: { 'three/webgpu': threeStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './tsl-materials.js': materialsStub },
  globals, filename: 'landmark-kit.js'
});
const lmModules = {};
for (const name of ['landmarks-rynek', 'landmarks-heritage', 'landmarks-centrum', 'landmarks-dworzec',
  'landmarks-towers', 'landmarks-historic', 'landmarks-stadium', 'landmarks-piotrowo']) {
  lmModules['./' + name + '.js'] = loadModule(source(name), {
    imports: { 'three/webgpu': threeStub, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
      './city-config.js': config, './geodata.js': { GEO }, './landmark-kit.js': kit,
      './tsl-materials.js': materialsStub,
      './city-clock.js': inert(), './baltyk-disco.js': inert() },
    globals, filename: name + '.js'
  });
}
const landmarksMod = loadModule(source('landmarks'), {
  imports: { 'three/webgpu': threeStub, './city-config.js': config, './landmark-kit.js': kit,
    './city-grid.js': inert(), ...lmModules },
  globals, filename: 'landmarks.js'
});
const buildingsMod = loadModule(source('buildings'), {
  imports: { 'three/webgpu': threeStub, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': materialsStub,
    './roofs.js': inert(), './balconies.js': inert(), './city-grid.js': inert() },
  globals, filename: 'buildings.js'
});
const gridSnapshot = '\nexport function snapshot() { return { ' +
  'pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }';
const gridMod = loadModule(source('city-grid') + gridSnapshot, {
  imports: { 'three/webgpu': inertThree, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'city-grid.js'
});
const canopiesMod = loadModule(source('canopies'), {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'canopies.js'
});
const bridgesMod = loadModule(source('bridges'), {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'bridges.js'
});
const tramMod = loadModule(source('tram-infra') + '\nexport { SPAN_Y };', {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': tslStub },
  globals, filename: 'tram-infra.js'
});
const { SPAN_Y } = tramMod;

const landmarks = landmarksMod.buildLandmarks(new Group());
const cityBlocks = buildingsMod.buildCityBlocks(new Group());
const buildingColliders = [...landmarks.colliders, ...cityBlocks.colliders];
const grid = gridMod.buildCityGrid(new Group(), { buildingFootprints: cityBlocks.footprintsByBlock,
  buildingColliders });
const liveGrid = { ...gridMod, ...gridMod.snapshot() };
const canopies = canopiesMod.buildCanopies(new Group());
const bridges = bridgesMod.buildBridges(new Group(), { sidewalks: grid.sidewalks });
const allColliders = [...landmarks.colliders, ...cityBlocks.colliders, ...canopies.colliders,
  ...bridges.colliders, ...(grid.colliders || [])];

let capturedLamps = [];
globals.captureLamps = (items, footprints) => {
  capturedLamps = items.filter((p) => footprints[p.fpIdx]).map((p) => ({
    x: p.pole.x, z: p.pole.z, type: p.type, scale: p.scale || 1
  }));
};
const detailsSource = source('street-details').replace('    const compact = (arr) => {',
  '    captureLamps(placedLamps, footprints);\n    const compact = (arr) => {');
const detailsMod = loadModule(detailsSource, {
  imports: {
    'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './road-network.js': road, './tsl-materials.js': tslStub,
    './trees.js': { createTreeField: (_s, trees) => { capturedTrees = trees; return { group: inert() }; } },
    './city-grid.js': liveGrid
  },
  globals, filename: 'street-details.js'
});
let capturedTrees = [];
const details = detailsMod.buildStreetDetails(new Group(), {
  buildingColliders: allColliders,
  grid,
  layoutTramInfrastructure: tramMod.layoutTramInfrastructure
});
const network = road.buildRoadNetwork(grid.sidewalks, [
  ...grid.footprints,
  ...details.footprints,
  ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
]);
const pedRoutes = pedRoutesMod.createPedestrianRoutes(network, config.blockAt, gridMod.railClearance,
  buildingColliders, config.PEDESTRIAN_WAYS);
const tramLayout = details.tramLayout || tramMod.layoutTramInfrastructure(network, grid);
const railLayout = tramMod.layoutRailInfrastructure(network);
details.addRuntimeSignalHeads(network, pedRoutes, [...tramLayout.poles, ...railLayout.masts]);

// Point/circle against the actual rotated canopy deck. The radius includes the prop's ground footprint.
function circleHits(c, x, z, r) {
  const dx = x - c.cx, dz = z - c.cz, cs = Math.cos(c.ang), sn = Math.sin(c.ang);
  const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;
  return Math.hypot(Math.max(0, Math.abs(u) - c.w / 2), Math.max(0, Math.abs(v) - c.d / 2)) < r;
}
// Exact line/rectangle intersection in canopy coordinates, for horizontal support arms and spans.
function segmentHits(c, s) {
  const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
  const local = (x, z) => [(x - c.cx) * cs + (z - c.cz) * sn, -(x - c.cx) * sn + (z - c.cz) * cs];
  const a = local(s.ax, s.az), b = local(s.bx, s.bz);
  let lo = 0, hi = 1;
  for (let i = 0; i < 2; i++) {
    const h = (i ? c.d : c.w) / 2, d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (Math.abs(a[i]) > h) return false; continue; }
    let t0 = (-h - a[i]) / d, t1 = (h - a[i]) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    if (lo > hi) return false;
  }
  return true;
}
// Match the generator's source roof rings by rounded area and the bounds in the stored rectangle frame. Ambiguous
// matches are treated as unavailable; the conservative fallback requires a track-free rectangle and 2.5 m clearance.
let roofRings = [];
try {
  const snapshot = JSON.parse(readFileSync(join(root, 'tools/data/poz_buildings.json'), 'utf8'));
  const [a, b, c, d, e, f] = GEO.frame.ll;
  const project = (lon, lat) => [a * lon + b * lat + c, d * lon + e * lat + f];
  for (const element of snapshot.elements) if (element.tags?.building === 'roof') {
    for (const ring of elemRings(element, project)) if (ring.length >= 3) {
      roofRings.push({ ring, area: Math.round(Math.abs(ringArea(ring))) });
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const roofRingCache = new Map();
function sourceRoofRing(index, canopy) {
  if (roofRingCache.has(index)) return roofRingCache.get(index);
  const cs = Math.cos(canopy.ang), sn = Math.sin(canopy.ang);
  const matches = roofRings.filter((entry) => {
    if (entry.area !== canopy.area) return false;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of entry.ring) {
      const dx = x - canopy.cx, dz = z - canopy.cz;
      const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return Math.abs(u0 + canopy.w / 2) < 0.2 && Math.abs(u1 - canopy.w / 2) < 0.2 &&
      Math.abs(v0 + canopy.d / 2) < 0.2 && Math.abs(v1 - canopy.d / 2) < 0.2;
  });
  const ring = matches.length === 1 ? matches[0].ring : null;
  roofRingCache.set(index, ring);
  return ring;
}
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const railSegments = [];
for (const track of GEO.rail) if (track.kind === 'rail') {
  for (let i = 2; i < track.pts.length; i += 2) {
    railSegments.push({ ax: track.pts[i - 2], az: track.pts[i - 1], bx: track.pts[i], bz: track.pts[i + 1] });
  }
}
function acceptedRoofOpening(index, canopy, mast) {
  const ring = sourceRoofRing(index, canopy);
  if (ring) return pointInRing(mast.x, mast.z, ring);
  const dx = mast.x - canopy.cx, dz = mast.z - canopy.cz, cs = Math.cos(canopy.ang), sn = Math.sin(canopy.ang);
  if (Math.abs(dx * cs + dz * sn) > canopy.w / 2 || Math.abs(-dx * sn + dz * cs) > canopy.d / 2 ||
      railSegments.some((segment) => segmentHits(canopy, segment))) return false;
  return railSegments.every(({ ax, az, bx, bz }) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((mast.x - ax) * dx + (mast.z - az) * dz) / l2)) : 0;
    return Math.hypot(mast.x - ax - t * dx, mast.z - az - t * dz) >= 2.5;
  });
}
const objects = [];
for (const p of capturedLamps) objects.push({ kind: p.type + '-lamp', x: p.x, z: p.z, r: p.type === 'led' ? 0.225 : 0.2,
  top: p.type === 'led' ? 0.1 + 10 * p.scale : 4.36 });
for (const p of liveGrid.parkLampSites || []) objects.push({ kind: 'park-lamp', x: p.x,
  z: p.z, r: 0.2, top: p.y + 0.28 });
for (const t of capturedTrees) objects.push({ kind: 'tree', x: t.x, z: t.z, r: 0.28 * (t.scale || 1), top: Infinity });
for (const p of tramLayout.poles) objects.push({ kind: 'tram-pole', x: p.x, z: p.z, r: 0.16, top: p.h });
for (const p of railLayout.masts) objects.push({ kind: 'rail-mast', x: p.x, z: p.z, r: 0.2, top: p.h });
for (const p of details.footprints) if (p.kind === 'signal') objects.push({ kind: 'signal',
  x: (p.minX + p.maxX) / 2, z: (p.minZ + p.maxZ) / 2, r: Math.max(p.maxX - p.minX, p.maxZ - p.minZ) / 2,
  top: 4.1 });
for (const st of tramLayout.stops) if (st.shelter) objects.push({ kind: 'shelter', x: st.shelter.x,
  z: st.shelter.z, r: 0.1, top: 2.8 });
const hits = [];
const acceptedRoofOpenings = [];
for (const [index, c] of GEO.canopies.entries()) {
  for (const o of objects) if (o.top > c.clearance && circleHits(c, o.x, o.z, o.r)) {
    const hit = { index, canopyKind: c.kind, cx: c.cx, cz: c.cz, clearance: c.clearance, ...o,
      top: Number.isFinite(o.top) ? o.top : null };
    if ((c.kind === 'platform' || c.kind === 'roof') && o.kind === 'rail-mast' && acceptedRoofOpening(index, c, o)) {
      acceptedRoofOpenings.push(hit);
    } else hits.push(hit);
  }
  for (const [kind, segments] of [['tram-arm', tramLayout.arms], ['tram-span', tramLayout.spans]]) {
    if (SPAN_Y <= c.clearance) continue;
    for (const s of segments) if (segmentHits(c, s)) hits.push({ index, canopyKind: c.kind,
      cx: c.cx, cz: c.cz, clearance: c.clearance, kind, x: s.ax, z: s.az, bx: s.bx, bz: s.bz,
      top: SPAN_Y });
  }
}
const counts = {};
for (const h of hits) { const k = h.canopyKind + '/' + h.kind; counts[k] = (counts[k] || 0) + 1; }
const targetCanopies = tramLayout.canopyKeepout.canopies.map((c) => GEO.canopies.indexOf(c));
const hangers = tramLayout.droppers.filter((d) => d.canopy).map((d) => ({
  x: d.x, z: d.z, top: d.y0 + 0.15,
  canopy: GEO.canopies.indexOf(tramLayout.canopyKeepout.at(d.x, d.z, 0.001, SPAN_Y).source)
}));
const tractionSupports = [...tramLayout.poles, ...railLayout.masts];
const missingSignalSupports = [];
for (const h of details.runtimeHeads) {
  if (!h.anchorTraction) continue;
  for (const [i, anchor] of h.anchors.entries()) {
    if (h.anchorTraction[i] && !tractionSupports.some((p) => Math.hypot(p.x - anchor.x, p.z - anchor.z) < 1e-6)) {
      missingSignalSupports.push({ x: anchor.x, z: anchor.z });
    }
  }
}
const data = {
  canopies: GEO.canopies.length, targetCanopies, counts, hits, acceptedRoofOpeningCount: acceptedRoofOpenings.length,
  acceptedRoofOpenings, hangers, missingSignalSupports,
  parkLampsUnderTransitDecks: GEO.canopies.flatMap((c, index) =>
    c.kind === 'tram' || c.kind === 'platform'
      ? (liveGrid.parkLampSites || []).filter((p) => circleHits(c, p.x, p.z, 0.27))
        .map((p) => ({ index, x: p.x, z: p.z })) : []),
  tramPoles: tramLayout.poles, tramArms: tramLayout.arms
};
if (jsonMode) console.log(JSON.stringify(data, null, 2));
else { console.log(JSON.stringify({ ...counts, acceptedRoofOpening: acceptedRoofOpenings.length }, null, 2));
  for (const h of hits) console.log(JSON.stringify(h)); }
