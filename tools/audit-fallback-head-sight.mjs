// Geometric sightline audit for stop-line fallback overhead signal heads.
// Reuses the headless world build from tools/audit-signal-heads.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

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
    apply: () => inert(), construct: () => inert()
  });
}

const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const rendering = {
  'three/webgpu': inert(),
  'three/tsl': inert(),
  'three/addons/utils/BufferGeometryUtils.js': inert(),
  './tsl-materials.js': inert()
};
const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };

const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const gridModule = loadModule(source('city-grid') +
  '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }', {
  imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...gridModule.snapshot() };
const audit = {};
const streetSource = source('street-details').replace(
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {',
  '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n' +
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {'
);
const street = loadModule(streetSource, {
  imports: {
    ...rendering,
    './city-config.js': config,
    './road-network.js': road,
    './city-grid.js': liveGrid,
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  },
  globals: { ...globals, audit }
}).buildStreetDetails(inert());

const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
  imports: { './road-network.js': road },
  globals
});
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const tramInfra = loadModule(source('tram-infra'), {
  imports: { ...rendering, './geodata.js': { GEO }, './city-config.js': config },
  globals
});
const tramLayout = tramInfra.layoutTramInfrastructure(network, grid);
const railLayout = tramInfra.layoutRailInfrastructure(network);
const supports = [...tramLayout.poles, ...railLayout.masts];

const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
vm.runInNewContext(`(${configure})`, {
  nodes: network.nodes,
  pedRoutes,
  KERB: 1.6,
  signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal,
  configureSignalClearance: config.configureSignalClearance
})();

street.addRuntimeSignalHeads(network);
street.addRuntimeSignalHeads(network, pedRoutes, supports, railLayout);

// Signal head geometry constants from js/street-details.js:304-306, 622
const OVERHEAD_Y = 5.3;
const S1_PITCH = 0.27;
const TOP_LAMP_Y = OVERHEAD_Y + S1_PITCH; // 5.57 m
const MID_LAMP_Y = OVERHEAD_Y; // 5.30 m
const BOT_LAMP_Y = OVERHEAD_Y - S1_PITCH; // 5.03 m

// Vehicle dimensions from js/actor-models.js & js/traffic.js:
// - Saloon/Taxi (BODY_SPECS.saloon): L = 4.60 (zFront 2.30, zRear -2.30), roof 1.435,
//   roofFront 0.02, roofY(0.02) 1.415, railF.y 1.330, B-pillar -0.28, halfWidth 0.889
// - Crossover (BODY_SPECS.crossover): L = 4.46 (zFront 2.23, zRear -2.23), roof 1.665, halfWidth 0.925
// - Bus 12m (BUS_SPEC): L = 12.00 (zFront 6.0, zRear -6.0), roof 3.005 (edge 2.96 + crown 0.045), halfWidth 1.275
// - Bus 18m (BUS_18_SPEC, traffic.js:529): L = 18.00 (halfL 9.0), roof 3.005, halfWidth 1.275
const VEH = {
  crossover: { len: 4.46, roof: 1.665, halfWidth: 0.925 },
  saloon: { len: 4.60, roof: 1.435, halfWidth: 0.889 },
  bus12: { len: 12.00, roof: 3.005, halfWidth: 1.275 },
  bus18: { len: 18.00, roof: 3.005, halfWidth: 1.275 }
};

// Stopped queue gaps from js/traffic.js:60, 926:
// - stopAt(v, d, s0 = 1): pos 1 front bumper stops 1.0 m before edge end (P-14).
// - CAR_DRIVER.s0 = 2.0 m: stopped car leaves 2.0 m bumper-to-bumper behind leader.
const STOP_GAP = 1.0;
const CAR_GAP = 2.0;

// Driver eye models:
// 1. pov: Player POV camera (js/cameras.js:288-289): fwdOffset = 0.55 on taxi (zFront 2.30 -> 1.75 m from front),
//    eyeY = 1.52 m (above 1.435 m taxi roof -> no own-roof cutoff).
// 2. seated: Driver seated in BODY_SPECS.saloon (js/actor-models.js:256-266, 690-695):
//    eye at z = -0.20 (ahead of B-pillar -0.28, 2.50 m from zFront), eyeY = 1.15 m;
//    windscreen top edge at roofFront = 0.02 (0.22 m ahead of eye), cabinTop(|x|=0.35) = 1.412 m -> 50.0 deg cutoff.
const EYE_MODELS = {
  pov: { setback: 1.75, eyeY: 1.52, maxPitchDeg: 90 },
  seated: { setback: 2.50, eyeY: 1.15, maxPitchDeg: Math.atan2(1.412 - 1.15, 0.22) * 180 / Math.PI }
};

function hitsBox(ax, ay, az, bx, by, bz, minX, maxX, minY, maxY, minZ, maxZ) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const [p, d, mn, mx] of [[ax, dx, minX, maxX], [ay, dy, minY, maxY], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < mn || p > mx) return false;
    } else {
      const inv = 1 / d;
      let u0 = (mn - p) * inv, u1 = (mx - p) * inv;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Build queue of vehicles in lane `latCenter` for positions 1..pos, where `frontTypes` lists vehicle keys.
function buildQueue(frontTypes, latCenter) {
  const boxes = [];
  let sFront = -STOP_GAP;
  for (let i = 0; i < frontTypes.length; i++) {
    const spec = VEH[frontTypes[i]];
    const sRear = sFront - spec.len;
    boxes.push({
      pos: i + 1,
      type: frontTypes[i],
      minS: sRear,
      maxS: sFront,
      minL: latCenter - spec.halfWidth,
      maxL: latCenter + spec.halfWidth,
      minY: 0,
      maxY: spec.roof
    });
    sFront = sRear - CAR_GAP;
  }
  return { boxes, driverFrontS: sFront };
}

function checkSight(headAlong, headLat, driverLaneLat, pos, caseName, eyeModelKey) {
  const eyeModel = EYE_MODELS[eyeModelKey];
  const carSpec = VEH.saloon;
  // Build queue ahead of driver (positions 1..pos-1) in driver's lane
  const frontTypes = [];
  for (let p = 1; p < pos; p++) {
    if (p === pos - 1 && (caseName === 'bus12' || caseName === 'bus18')) {
      frontTypes.push(caseName);
    } else {
      frontTypes.push(caseName === 'saloon' ? 'saloon' : 'crossover');
    }
  }
  const { boxes, driverFrontS } = buildQueue(frontTypes, driverLaneLat);
  const sEye = driverFrontS - eyeModel.setback;
  const lEye = driverLaneLat;
  const yEye = eyeModel.eyeY;

  const ds = headAlong - sEye;
  const dl = headLat - lEye;
  const horiz = Math.hypot(ds, dl);
  const dy = TOP_LAMP_Y - yEye;
  const pitchDeg = Math.atan2(dy, horiz) * 180 / Math.PI;

  if (pitchDeg > eyeModel.maxPitchDeg) {
    return { visible: false, reason: `own-roof (${pitchDeg.toFixed(1)}° > ${eyeModel.maxPitchDeg.toFixed(1)}°)`, pitchDeg };
  }
  for (const box of boxes) {
    if (hitsBox(sEye, yEye, lEye, headAlong, TOP_LAMP_Y, headLat,
      box.minS, box.maxS, box.minY, box.maxY, box.minL, box.maxL)) {
      return { visible: false, reason: `${box.type}@pos${box.pos}`, pitchDeg };
    }
  }
  return { visible: true, reason: 'ok', pitchDeg };
}

const overhead = street.runtimeHeads.filter((h) => h.overhead);
const fallbacks = overhead.filter((h) => !h.band);

console.log(`Fallback heads: ${fallbacks.length} (overhead total: ${overhead.length})`);

for (let idx = 0; idx < fallbacks.length; idx++) {
  const h = fallbacks[idx];
  const e = h.edge;
  const stopX = e.sx + e.dx * e.len, stopZ = e.sz + e.dz * e.len;
  const along = (h.p.x - stopX) * e.dx + (h.p.z - stopZ) * e.dz;
  const lat = (h.p.x - stopX) * e.rx + (h.p.z - stopZ) * e.rz;
  let overLane = 0;
  for (let i = 1; i < e.lanes.length; i++) {
    if (Math.abs(e.lanes[i] - lat) < Math.abs(e.lanes[overLane] - lat)) overLane = i;
  }
  const supportKind = h.bridge ? 'bridge' : h.span ? 'span' : 'cantilever';
  console.log(`\n=== Head #${idx + 1} (${supportKind}, existing=${!!h.existing}) ===`);
  console.log(`  pos=(${h.p.x.toFixed(3)}, ${h.p.z.toFixed(3)}), node=(${h.node.x.toFixed(2)}, ${h.node.z.toFixed(2)}), along=${along.toFixed(3)} m, lat=${lat.toFixed(3)} m (lane ${overLane} @ ${e.lanes[overLane].toFixed(2)} m), lanes=${e.lanes.length}, edgeLen=${e.len.toFixed(2)} m`);

  for (let laneIdx = 0; laneIdx < e.lanes.length; laneIdx++) {
    const laneLat = e.lanes[laneIdx];
    const tag = laneIdx === overLane ? '(under head)' : '(adjacent)';
    console.log(`  Lane ${laneIdx} @ ${laneLat.toFixed(2)} m ${tag}:`);
    for (const eyeKey of ['pov', 'seated']) {
      const rows = [];
      for (let pos = 1; pos <= 6; pos++) {
        const cCar = checkSight(along, lat, laneLat, pos, 'crossover', eyeKey);
        const cBus12 = pos === 1 ? { visible: cCar.visible, reason: '-' } : checkSight(along, lat, laneLat, pos, 'bus12', eyeKey);
        const cBus18 = pos === 1 ? { visible: cCar.visible, reason: '-' } : checkSight(along, lat, laneLat, pos, 'bus18', eyeKey);
        rows.push(`p${pos}[${cCar.pitchDeg.toFixed(0)}°]:car=${cCar.visible ? 'OK' : cCar.reason},b12=${pos === 1 ? '-' : (cBus12.visible ? 'OK' : cBus12.reason)},b18=${pos === 1 ? '-' : (cBus18.visible ? 'OK' : cBus18.reason)}`);
      }
      console.log(`    ${eyeKey.padEnd(6)}: ${rows.join(' | ')}`);
    }
  }
}

// Cross-check at 20 m back over a car (browser-checks-2026-11-14.md:126-129):
// Eye at 20 m back from head along approach, height 1.5 m, car in front at pos 1 (s = [-5.46, -1.0])
console.log('\n=== CROSS-CHECK: 20 m back from head over a car (eyeY=1.50 m) ===');
for (const idx of [0, 1]) {
  const h = fallbacks[idx];
  const e = h.edge;
  const stopX = e.sx + e.dx * e.len, stopZ = e.sz + e.dz * e.len;
  const along = (h.p.x - stopX) * e.dx + (h.p.z - stopZ) * e.dz;
  const lat = (h.p.x - stopX) * e.rx + (h.p.z - stopZ) * e.rz;
  let overLane = 0;
  for (let i = 1; i < e.lanes.length; i++) {
    if (Math.abs(e.lanes[i] - lat) < Math.abs(e.lanes[overLane] - lat)) overLane = i;
  }
  const laneLat = e.lanes[overLane];
  const sEye = along - 20;
  const car = { minS: -STOP_GAP - VEH.crossover.len, maxS: -STOP_GAP, minY: 0, maxY: VEH.crossover.roof, minL: laneLat - VEH.crossover.halfWidth, maxL: laneLat + VEH.crossover.halfWidth };
  const blocked = hitsBox(sEye, 1.50, laneLat, along, TOP_LAMP_Y, lat, car.minS, car.maxS, car.minY, car.maxY, car.minL, car.maxL);
  console.log(`  Head #${idx + 1} (${h.p.x.toFixed(1)}, ${h.p.z.toFixed(1)}): ${blocked ? 'BLOCKED' : 'VISIBLE'}`);
}
