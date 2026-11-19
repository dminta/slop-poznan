// Headless audit: every tram shelter's footprint (+ 0.3 m margin) and open-front access zone (1.2 m strip in front
// of the open +z side) against every placed object in the city (props, lamps, trees & pits, signs, signal poles,
// benches, bollards, hydrants, kiosks, columns, catenary poles, ticket machines, rail masts).
//
//   node tools/audit-shelter-clearance.mjs [--json] [--top N]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');
const satellites = await import('../js/satellite-sites.js');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const topIdx = args.indexOf('--top');
const topN = topIdx >= 0 ? Number(args[topIdx + 1]) : 50;

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
  imports: { 'three/webgpu': threeStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config, './tsl-materials.js': materialsStub },
  globals, filename: 'landmark-kit.js'
});
const lmModules = {};
for (const name of ['landmarks-rynek', 'landmarks-heritage', 'landmarks-centrum', 'landmarks-dworzec', 'landmarks-towers', 'landmarks-historic', 'landmarks-stadium', 'landmarks-piotrowo']) {
  lmModules['./' + name + '.js'] = loadModule(source(name), {
    imports: { 'three/webgpu': threeStub, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config, './geodata.js': { GEO }, './landmark-kit.js': kit, './tsl-materials.js': materialsStub, './city-clock.js': inert(), './baltyk-disco.js': inert() },
    globals, filename: name + '.js'
  });
}
const landmarksMod = loadModule(source('landmarks'), {
  imports: { 'three/webgpu': threeStub, './city-config.js': config, './landmark-kit.js': kit, './city-grid.js': inert(), ...lmModules },
  globals, filename: 'landmarks.js'
});
const buildingsMod = loadModule(source('buildings'), {
  imports: { 'three/webgpu': threeStub, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': materialsStub, './roofs.js': inert(), './balconies.js': inert(), './city-grid.js': inert() },
  globals, filename: 'buildings.js'
});
const gridMod = loadModule(source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
  imports: { 'three/webgpu': inertThree, 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'city-grid.js'
});
const canopiesMod = loadModule(source('canopies'), {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'canopies.js'
});
const bridgesMod = loadModule(source('bridges'), {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config, './geodata.js': { GEO }, './tsl-materials.js': tslStub },
  globals, filename: 'bridges.js'
});
const tramMod = loadModule(source('tram-infra'), {
  imports: { 'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(), './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': tslStub },
  globals, filename: 'tram-infra.js'
});

const landmarks = landmarksMod.buildLandmarks(new Group());
const cityBlocks = buildingsMod.buildCityBlocks(new Group());
const buildingColliders = [...landmarks.colliders, ...cityBlocks.colliders];
const grid = gridMod.buildCityGrid(new Group(), { buildingFootprints: cityBlocks.footprintsByBlock, buildingColliders });
const liveGrid = { ...gridMod, ...gridMod.snapshot() };
const canopies = canopiesMod.buildCanopies(new Group());
const bridges = bridgesMod.buildBridges(new Group(), { sidewalks: grid.sidewalks });
const allColliders = [...landmarks.colliders, ...cityBlocks.colliders, ...canopies.colliders, ...bridges.colliders, ...(grid.colliders || [])];

const detailsMod = loadModule(source('street-details'), {
  imports: {
    'three/webgpu': inertThree, 'three/tsl': tslStub, 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config, './road-network.js': road, './tsl-materials.js': tslStub,
    './satellite-sites.js': satellites,
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
const pedRoutes = pedRoutesMod.createPedestrianRoutes(network, config.blockAt, gridMod.railClearance, buildingColliders, config.PEDESTRIAN_WAYS);
const tramLayout = details.tramLayout || tramMod.layoutTramInfrastructure(network, grid);
const railLayout = tramMod.layoutRailInfrastructure(network);
details.addRuntimeSignalHeads(network, pedRoutes, [...tramLayout.poles, ...railLayout.masts]);

// Geometry helpers: OBB vs OBB (SAT) and OBB vs Circle
function makeObb(x, z, hx, hz, yaw = 0) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x, z, hx, hz, ux: cs, uz: -sn, vx: sn, vz: cs };
}

function obbOverlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ax, az] of [[a.ux, a.uz], [a.vx, a.vz], [b.ux, b.uz], [b.vx, b.vz]]) {
    const dist = Math.abs(dx * ax + dz * az);
    const ra = a.hx * Math.abs(a.ux * ax + a.uz * az) + a.hz * Math.abs(a.vx * ax + a.vz * az);
    const rb = b.hx * Math.abs(b.ux * ax + b.uz * az) + b.hz * Math.abs(b.vx * ax + b.vz * az);
    if (dist >= ra + rb) return false;
  }
  return true;
}

function obbCircleOverlap(a, cx, cz, r) {
  const dx = cx - a.x, dz = cz - a.z;
  const lx = dx * a.ux + dz * a.uz;
  const lz = dx * a.vx + dz * a.vz;
  const qx = Math.max(-a.hx, Math.min(a.hx, lx));
  const qz = Math.max(-a.hz, Math.min(a.hz, lz));
  const rx = lx - qx, rz = lz - qz;
  return rx * rx + rz * rz < r * r;
}

// Collect all placed objects with their footprints
const objects = [];

// 1. Street-details footprints (signals, gas, led, hydrant, postbox, parking, bollard, column, kiosk, flower)
for (const fp of details.footprints) {
  const cx = (fp.minX + fp.maxX) * 0.5, cz = (fp.minZ + fp.maxZ) * 0.5;
  const hx = (fp.maxX - fp.minX) * 0.5, hz = (fp.maxZ - fp.minZ) * 0.5;
  objects.push({
    kind: fp.kind || 'prop',
    source: 'street-details.footprints',
    x: cx, z: cz,
    obb: makeObb(cx, cz, hx, hz, 0)
  });
}

// 2. Trees (trunks) and street tree pits
for (const t of capturedTrees) {
  const r = 0.28 * (t.scale || 1);
  objects.push({
    kind: 'tree-trunk',
    source: t.source || 'tree',
    x: t.x, z: t.z,
    r
  });
  if (t.pitRot !== undefined || t.pitS !== undefined || t.grate !== undefined) {
    const ps = t.pitS ?? 1;
    objects.push({
      kind: 'tree-pit',
      source: t.source || 'street-tree',
      x: t.x, z: t.z,
      obb: makeObb(t.x, t.z, 0.85 * ps, 1.3 * ps, t.pitRot || 0)
    });
  }
}

// 3. City-grid propColliders (benches, grid lampposts, granite planters, grid tree trunks)
for (const c of grid.propColliders || []) {
  if (c.obb) {
    const cx = c.obb.cx ?? c.obb.x ?? (c.minX + c.maxX) * 0.5;
    const cz = c.obb.cz ?? c.obb.z ?? (c.minZ + c.maxZ) * 0.5;
    objects.push({
      kind: 'grid-prop-obb',
      source: 'city-grid.propColliders',
      x: cx, z: cz,
      obb: { x: cx, z: cz, hx: c.obb.hx, hz: c.obb.hz, ux: c.obb.cs, uz: -c.obb.sn, vx: c.obb.sn, vz: c.obb.cs }
    });
  } else {
    const cx = (c.minX + c.maxX) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
    const hx = (c.maxX - c.minX) * 0.5, hz = (c.maxZ - c.minZ) * 0.5;
    objects.push({
      kind: Math.abs(hx - 1.2) < 0.05 ? 'grid-planter' : Math.abs(hx - 0.2) < 0.05 ? 'grid-lamp' : 'grid-prop',
      source: 'city-grid.propColliders',
      x: cx, z: cz,
      obb: makeObb(cx, cz, hx, hz, 0)
    });
  }
}

// 4. Tram poles, rail masts, stop signs and ticket machines
for (const p of tramLayout.poles) {
  objects.push({ kind: 'tram-pole', source: 'tramLayout.poles', x: p.x, z: p.z, r: 0.16 });
}
for (const m of railLayout.masts) {
  objects.push({ kind: 'rail-mast', source: 'railLayout.masts', x: m.x, z: m.z, r: 0.2 });
}
for (const st of tramLayout.stops) {
  if (st.sign) {
    objects.push({ kind: 'stop-sign', source: `stop(${st.name})`, x: st.sign.x, z: st.sign.z, r: 0.08 });
  }
  if (st.machine) {
    objects.push({
      kind: 'ticket-machine',
      source: `stop(${st.name})`,
      x: st.machine.x, z: st.machine.z,
      obb: makeObb(st.machine.x, st.machine.z, 0.31, 0.24, st.machine.yaw || 0)
    });
  }
}

// Audit every shelter
const MARGIN = 0.3;
const ACCESS_DEPTH = 1.2;
const shelterStops = tramLayout.stops.filter((st) => st.shelter);
const hits = [];
const strictPoleHits = [];

for (const st of shelterStops) {
  const sh = st.shelter;
  const rect = tramMod.shelterRect(sh.x, sh.z, sh.yaw, sh.len);
  const footMargin = { ...rect, hx: rect.hx + MARGIN, hz: rect.hz + MARGIN };
  const accessZone = {
    ...rect,
    x: rect.x + rect.vx * (rect.hz + ACCESS_DEPTH * 0.5),
    z: rect.z + rect.vz * (rect.hz + ACCESS_DEPTH * 0.5),
    hz: ACCESS_DEPTH * 0.5
  };

  const shelterHits = [];
  for (const obj of objects) {
    const dx = obj.x - sh.x, dz = obj.z - sh.z;
    if (dx * dx + dz * dz > 64) continue;
    if (obj.kind === 'tram-pole' && (obbCircleOverlap(footMargin, obj.x, obj.z, obj.r) ||
        obbCircleOverlap(accessZone, obj.x, obj.z, obj.r))) {
      strictPoleHits.push({ name: st.name, x: Number(sh.x.toFixed(2)), z: Number(sh.z.toFixed(2)),
        zone: obbCircleOverlap(rect, obj.x, obj.z, obj.r) ? 'footprint'
          : obbCircleOverlap(footMargin, obj.x, obj.z, obj.r) ? 'margin' : 'access',
        lx: Number((dx * rect.ux + dz * rect.uz).toFixed(2)),
        lz: Number((dx * rect.vx + dz * rect.vz).toFixed(2)) });
    }
    const inFootprint = obj.obb ? obbOverlap(rect, obj.obb) : obbCircleOverlap(rect, obj.x, obj.z, obj.r);
    const inMargin = obj.kind === 'tram-pole'
      ? tramMod.poleInShelterRect(rect, obj)
      : (obj.obb ? obbOverlap(footMargin, obj.obb) : obbCircleOverlap(footMargin, obj.x, obj.z, obj.r));
    const inAccess = obj.kind === 'tram-pole'
      ? false
      : (obj.obb ? obbOverlap(accessZone, obj.obb) : obbCircleOverlap(accessZone, obj.x, obj.z, obj.r));
    if (!inMargin && !inAccess) continue;
    const lx = dx * rect.ux + dz * rect.uz;
    const lz = dx * rect.vx + dz * rect.vz;
    shelterHits.push({
      kind: obj.kind,
      source: obj.source,
      x: Number(obj.x.toFixed(2)),
      z: Number(obj.z.toFixed(2)),
      lx: Number(lx.toFixed(2)),
      lz: Number(lz.toFixed(2)),
      zone: inFootprint ? 'footprint' : inMargin ? 'margin' : 'access'
    });
  }
  if (shelterHits.length) {
    hits.push({
      name: st.name,
      x: Number(sh.x.toFixed(2)),
      z: Number(sh.z.toFixed(2)),
      yawDeg: Number(((sh.yaw * 180) / Math.PI).toFixed(1)),
      len: sh.len,
      items: shelterHits
    });
  }
}

// Also check trees and tree pits against ticket machines and stop signs
const stopFurniture = objects.filter((o) => o.kind === 'ticket-machine' || o.kind === 'stop-sign');
const treeObjects = objects.filter((o) => o.kind === 'tree-trunk' || o.kind === 'tree-pit');
const furnitureHits = [];
for (const tr of treeObjects) {
  for (const sf of stopFurniture) {
    const dx = tr.x - sf.x, dz = tr.z - sf.z;
    if (dx * dx + dz * dz > 25) continue;
    const hit = sf.obb
      ? (tr.obb ? obbOverlap(sf.obb, tr.obb) : obbCircleOverlap(sf.obb, tr.x, tr.z, tr.r))
      : (tr.obb ? obbCircleOverlap(tr.obb, sf.x, sf.z, sf.r) : Math.hypot(dx, dz) < tr.r + sf.r);
    if (hit) {
      furnitureHits.push({
        treeKind: tr.kind, source: tr.source, x: Number(tr.x.toFixed(2)), z: Number(tr.z.toFixed(2)),
        furnitureKind: sf.kind, stop: sf.source, fx: Number(sf.x.toFixed(2)), fz: Number(sf.z.toFixed(2))
      });
    }
  }
}

const byZone = { footprint: 0, margin: 0, access: 0 };
const byKind = {};
for (const s of hits) {
  for (const it of s.items) {
    byZone[it.zone]++;
    byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  }
}

const strictByZone = { footprint: 0, margin: 0, access: 0 };
const strictByKind = {};
const strictShelters = new Set(hits.map((p) => `${p.x},${p.z}`));
for (const s of hits) for (const it of s.items) {
  if (it.kind === 'tram-pole') continue;
  strictByZone[it.zone]++;
  strictByKind[it.kind] = (strictByKind[it.kind] || 0) + 1;
}
for (const p of strictPoleHits) {
  strictShelters.add(`${p.x},${p.z}`);
  strictByZone[p.zone]++;
  strictByKind['tram-pole'] = (strictByKind['tram-pole'] || 0) + 1;
}

if (jsonMode) {
  console.log(JSON.stringify({ shelters: shelterStops.length, affectedShelters: hits.length, byZone, byKind, hits, furnitureHits, strictPoleHits, strictAffectedShelters: strictShelters.size, strictByZone, strictByKind }, null, 2));
} else {
  console.log(`Shelters: ${shelterStops.length}, affected: ${hits.length}, byZone: ${JSON.stringify(byZone)}, byKind: ${JSON.stringify(byKind)}, treeOnFurniture: ${furnitureHits.length}, strict pole fallback shelters: ${new Set(strictPoleHits.map((p) => `${p.x},${p.z}`)).size}`);
  for (const p of strictPoleHits) console.log(`- [strict pole fallback] ${p.name} local=(${p.lx}, ${p.lz})`);
  for (const s of hits.slice(0, topN)) {
    console.log(`- ${s.name} (${s.x}, ${s.z}) yaw=${s.yawDeg}° len=${s.len}:`);
    for (const it of s.items) {
      console.log(`    [${it.zone}] ${it.kind} (${it.source}) at (${it.x}, ${it.z}) local=(${it.lx}, ${it.lz})`);
    }
  }
  for (const fh of furnitureHits.slice(0, topN)) {
    console.log(`- [${fh.furnitureKind}] ${fh.stop} (${fh.fx}, ${fh.fz}) hit by ${fh.treeKind} (${fh.source}) at (${fh.x}, ${fh.z})`);
  }
}

process.exitCode = (hits.length > 0 || furnitureHits.length > 0) ? 1 : 0;
