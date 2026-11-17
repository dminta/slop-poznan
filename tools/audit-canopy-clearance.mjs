// Audit tall prop footprints and tram support segments against every mapped canopy deck.
// Trees are treated as tall; the audit tests trunks rather than crowns. Run with --json for all hits.
// Railway cantilevers, contact wires, lamp-arm intersections and signal heads outside their pole footprint are omitted.
//   node tools/audit-canopy-clearance.mjs [--json]

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
for (const [index, c] of GEO.canopies.entries()) {
  for (const o of objects) if (o.top > c.clearance && circleHits(c, o.x, o.z, o.r)) hits.push({ index,
    canopyKind: c.kind, cx: c.cx, cz: c.cz, clearance: c.clearance, ...o,
    top: Number.isFinite(o.top) ? o.top : null });
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
  canopies: GEO.canopies.length, targetCanopies, counts, hits, hangers, missingSignalSupports,
  tramPoles: tramLayout.poles, tramArms: tramLayout.arms
};
if (jsonMode) console.log(JSON.stringify(data, null, 2));
else { console.log(JSON.stringify(counts, null, 2)); for (const h of hits) console.log(JSON.stringify(h)); }
