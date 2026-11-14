// Headless geometric and controller-simulation audit of every tram/bus stop furniture item built by js/tram-infra.js
// (shelters, stop signs, ticket machines) against its player collider in stopFurnitureColliders().
//
//   node tools/audit-stop-furniture-colliders.mjs [--json] [--top N]
//
// Builds the furnished headless network (as tools/audit-shelter-roadway.mjs does), captures the actual instanced
// furniture matrices from buildTramInfrastructure(), compares each item's visual parts at player height (y < 1.9 m)
// against its collider(s) for walk-through gaps and invisible walls, and walks/drives the real controller collision
// solver against the named diagonal shelters at Dworzec Zachodni and Żniwna (plus the 2026-11-11 (-1552.6, 229.7)
// shelter).
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
const topIndex = args.indexOf('--top');
const topN = topIndex >= 0 ? Number(args[topIndex + 1]) : 10;

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

function createThreeStubs() {
  const instances = new Map();
  const three = inert();
  three.Group = function () {
    const g = inert();
    g.children = [];
    g.add = (m) => { if (m) g.children.push(m); };
    return g;
  };
  three.Object3D = function () {
    return {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      matrix: null,
      updateMatrix() {
        this.matrix = {
          px: this.position.x, py: this.position.y, pz: this.position.z,
          ry: this.rotation.y,
          sx: this.scale.x, sy: this.scale.y, sz: this.scale.z,
          clone() { return { ...this }; }
        };
      }
    };
  };
  three.InstancedMesh = function (geometry, material, count) {
    const matrices = new Array(count);
    return {
      geometry,
      material,
      count,
      instanceMatrix: {},
      castShadow: true,
      receiveShadow: true,
      computeBoundingSphere() {},
      setMatrixAt(i, m) { matrices[i] = m; },
      set name(v) { instances.set(v, { count, matrices }); }
    };
  };
  return { three, instances };
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
      pavedPlazaRects: [], parkTreeSites: [], parkLampSites: [], clearOfRails: grid.clearOfRails
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

const { three, instances } = createThreeStubs();
const tram = loadModule(source('tram-infra'), {
  imports: {
    'three/webgpu': three, 'three/tsl': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(),
    './geodata.js': { GEO }, './city-config.js': config, './tsl-materials.js': inert()
  },
  globals: {
    Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol, Float32Array, Uint8Array, Uint16Array, Uint32Array,
    Int32Array, Float64Array, Promise, String, Error, document: inert(), console: { info() {}, warn() {}, log() {} }
  },
  filename: 'tram-infra.js'
});

const layout = tram.layoutTramInfrastructure(network);
const built = tram.buildTramInfrastructure(three.Group(), network, { tram: layout });
const stops = layout.stops;

// Controller module for real collision resolution (person capsule and car OBB SAT).
const windowStub = { addEventListener() {} };
const documentStub = { addEventListener() {}, hidden: false };
const { ThirdPersonControllerManager } = loadModule(source('controllers'), {
  globals: { window: windowStub, document: documentStub },
  imports: {
    'three/webgpu': three,
    'three/tsl': inert(),
    './city-config.js': config,
    './tsl-materials.js': inert(),
    './actor-models.js': inert(),
    './pedestrians.js': inert(),
    './vehicle-lights.js': inert()
  },
  filename: 'controllers.js'
});

// Geometry helpers in local (lx, lz) and world (wx, wz) space.
// Three.js rotation.y = yaw maps local (lx, lz) -> world:
//   wx = cx + lx * cos(yaw) + lz * sin(yaw)
//   wz = cz - lx * sin(yaw) + lz * cos(yaw)
function toWorld(cx, cz, yaw, lx, lz) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
}

function toLocal(cx, cz, cs, sn, wx, wz) {
  const dx = wx - cx, dz = wz - cz;
  return [dx * cs - dz * sn, dx * sn + dz * cs];
}

// Distance from point (wx, wz) to an OBB collider (0 when inside).
function distToObb(c, wx, wz) {
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const cx = o ? o.cx : (c.minX + c.maxX) * 0.5;
  const cz = o ? o.cz : (c.minZ + c.maxZ) * 0.5;
  const [lx, lz] = toLocal(cx, cz, cs, sn, wx, wz);
  const qx = Math.max(0, Math.abs(lx) - hx);
  const qz = Math.max(0, Math.abs(lz) - hz);
  return Math.hypot(qx, qz);
}

// Distance from local point (lx, lz) to a local axis-aligned box [x0, x1] x [z0, z1] (0 when inside).
function distToLocalRect(lx, lz, r) {
  const dx = lx < r.x0 ? r.x0 - lx : lx > r.x1 ? lx - r.x1 : 0;
  const dz = lz < r.z0 ? r.z0 - lz : lz > r.z1 ? lz - r.z1 : 0;
  return Math.hypot(dx, dz);
}

// Sample points along a local rectangle's perimeter and interior.
function sampleLocalRect(r, step = 0.05) {
  const pts = [];
  const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / step));
  const nz = Math.max(1, Math.ceil((r.z1 - r.z0) / step));
  for (let ix = 0; ix <= nx; ix++) {
    const x = r.x0 + ((r.x1 - r.x0) * ix) / nx;
    for (let iz = 0; iz <= nz; iz++) {
      const z = r.z0 + ((r.z1 - r.z0) * iz) / nz;
      pts.push([x, z]);
    }
  }
  return pts;
}

// Visual parts at player height (y < 1.9 m) in the instance's local coordinates (matches js/tram-infra.js:2195-2222).
function shelterVisualRects(len) {
  const s = len / 4.4;
  return [
    // 4 corner posts (0.07 x 2.45 x 0.07 at (±2.15, 1.225, ±0.62))
    { part: 'post-bl', x0: (-2.15 - 0.035) * s, x1: (-2.15 + 0.035) * s, z0: -0.62 - 0.035, z1: -0.62 + 0.035 },
    { part: 'post-br', x0: (2.15 - 0.035) * s, x1: (2.15 + 0.035) * s, z0: -0.62 - 0.035, z1: -0.62 + 0.035 },
    { part: 'post-fl', x0: (-2.15 - 0.035) * s, x1: (-2.15 + 0.035) * s, z0: 0.62 - 0.035, z1: 0.62 + 0.035 },
    { part: 'post-fr', x0: (2.15 - 0.035) * s, x1: (2.15 + 0.035) * s, z0: 0.62 - 0.035, z1: 0.62 + 0.035 },
    // Back glass (PlaneGeometry(4.2, 2.1) at (0, 1.2, -0.62))
    { part: 'back-glass', x0: -2.1 * s, x1: 2.1 * s, z0: -0.62, z1: -0.62 },
    // Left end glass (PlaneGeometry(1.2, 2.1) at (-2.15, 1.2, 0))
    { part: 'left-glass', x0: -2.15 * s, x1: -2.15 * s, z0: -0.6, z1: 0.6 },
    // Right end advert box (BoxGeometry(0.1, 1.75, 1.2) at (2.15, 1.15, 0))
    { part: 'right-advert', x0: 2.1 * s, x1: 2.2 * s, z0: -0.6, z1: 0.6 },
    // Bench seat (2.4 x 0.06 x 0.4 at (0, 0.46, -0.38)) and legs
    { part: 'bench', x0: -1.2 * s, x1: 1.2 * s, z0: -0.58, z1: -0.18 }
  ];
}

function signVisualRects() {
  // CylinderGeometry(0.04, 0.04, 2.9, 8) at (0, 1.45, 0); name plate at y = 2.65 is above player top 1.9 m.
  return [{ part: 'pole', r: 0.04, x0: -0.04, x1: 0.04, z0: -0.04, z1: 0.04 }];
}

function machineVisualRects() {
  // Body 0.55 x 1.6 x 0.4 and top cap 0.62 x 0.08 x 0.48 (y = 1.64, within player top 1.9 m).
  return [
    { part: 'body', x0: -0.275, x1: 0.275, z0: -0.2, z1: 0.2 },
    { part: 'cap', x0: -0.31, x1: 0.31, z0: -0.24, z1: 0.24 }
  ];
}

// Verify instanced mesh counts match stop furniture counts.
const shelterStops = stops.filter((s) => s.shelter);
const signStops = stops.filter((s) => s.sign);
const machineStops = stops.filter((s) => s.machine);
const frameInst = instances.get('TramShelterFrames');
const signInst = instances.get('TramStopSignPoles');
const machineInst = instances.get('TicketMachines');

// Audit every furniture item by comparing its visual geometry against stopFurnitureColliders([st]).
function auditKind(kind, items, getItem, getVisualRects) {
  let maxGap = 0;
  let maxExcess = 0;
  const gaps = [];
  const excesses = [];
  let aabbMismatches = 0;
  let nonObbCount = 0;

  for (const st of items) {
    const item = getItem(st);
    const cols = tram.stopFurnitureColliders([{
      ...st,
      shelter: kind === 'shelter' ? st.shelter : null,
      sign: kind === 'sign' ? st.sign : null,
      machine: kind === 'machine' ? st.machine : null
    }]);
    for (const c of cols) {
      if (!c.obb) nonObbCount++;
      else {
        const ex = Math.abs(c.obb.cs) * c.obb.hx + Math.abs(c.obb.sn) * c.obb.hz;
        const ez = Math.abs(c.obb.sn) * c.obb.hx + Math.abs(c.obb.cs) * c.obb.hz;
        if (Math.abs(c.minX - (c.obb.cx - ex)) > 1e-6 || Math.abs(c.maxX - (c.obb.cx + ex)) > 1e-6 ||
            Math.abs(c.minZ - (c.obb.cz - ez)) > 1e-6 || Math.abs(c.maxZ - (c.obb.cz + ez)) > 1e-6) {
          aabbMismatches++;
        }
      }
    }

    const visuals = getVisualRects(item);
    let itemMaxGap = 0;
    let itemGapPt = null;
    for (const v of visuals) {
      for (const [lx, lz] of sampleLocalRect(v, 0.05)) {
        const [wx, wz] = toWorld(item.x, item.z, item.yaw, lx, lz);
        let minD = Infinity;
        for (const c of cols) {
          const d = distToObb(c, wx, wz);
          if (d < minD) minD = d;
        }
        if (minD > itemMaxGap) {
          itemMaxGap = minD;
          itemGapPt = { name: st.name, kind: st.kind, x: wx, z: wz, part: v.part, gap: minD };
        }
      }
    }
    if (itemMaxGap > maxGap) maxGap = itemMaxGap;
    if (itemGapPt && itemGapPt.gap > 1e-6) gaps.push(itemGapPt);

    let itemMaxExcess = 0;
    let itemExcessPt = null;
    for (const c of cols) {
      const o = c.obb;
      const yaw = Math.atan2(o.sn, o.cs);
      const localC = { x0: -o.hx, x1: o.hx, z0: -o.hz, z1: o.hz };
      for (const [clx, clz] of sampleLocalRect(localC, 0.05)) {
        const [wx, wz] = toWorld(o.cx, o.cz, yaw, clx, clz);
        // Transform world point into item's local space to measure distance to visual parts.
        const [ilx, ilz] = toLocal(item.x, item.z, Math.cos(item.yaw), Math.sin(item.yaw), wx, wz);
        let minD = Infinity;
        for (const v of visuals) {
          const d = v.r != null
            ? Math.max(0, Math.hypot(ilx, ilz) - v.r)
            : distToLocalRect(ilx, ilz, v);
          if (d < minD) minD = d;
        }
        if (minD > itemMaxExcess) {
          itemMaxExcess = minD;
          itemExcessPt = {
            name: st.name, kind: st.kind, shelterX: item.x, shelterZ: item.z, yaw: item.yaw,
            x: wx, z: wz, localX: ilx, localZ: ilz, excess: minD
          };
        }
      }
    }
    if (itemMaxExcess > maxExcess) maxExcess = itemMaxExcess;
    if (itemExcessPt && itemExcessPt.excess > 1e-6) excesses.push(itemExcessPt);
  }

  gaps.sort((a, b) => b.gap - a.gap);
  excesses.sort((a, b) => b.excess - a.excess);
  return {
    count: items.length,
    nonObbCount,
    aabbMismatches,
    maxVisualOutsideCollider: maxGap,
    maxColliderBeyondVisual: maxExcess,
    worstGaps: gaps.slice(0, topN),
    worstExcesses: excesses.slice(0, topN)
  };
}

const audit = {
  instancedCounts: {
    shelters: { stops: shelterStops.length, instanced: frameInst?.count ?? 0 },
    signs: { stops: signStops.length, instanced: signInst?.count ?? 0 },
    machines: { stops: machineStops.length, instanced: machineInst?.count ?? 0 }
  },
  shelter: auditKind('shelter', shelterStops, (s) => s.shelter, (sh) => shelterVisualRects(sh.len)),
  sign: auditKind('sign', signStops, (s) => s.sign, () => signVisualRects()),
  machine: auditKind('machine', machineStops, (s) => s.machine, () => machineVisualRects())
};

// Headless controller simulation on named diagonal shelters: Dworzec Zachodni, Żniwna, and (-1552.6, 229.7).
function makeController(colliders, baseY) {
  const mgr = Object.create(ThirdPersonControllerManager.prototype);
  mgr.colliders = colliders;
  mgr._colliderCells = null;
  mgr.keepOut = null;
  mgr.activeMode = 'person';
  mgr.keys = { forward: 0, backward: 0, left: 0, right: 0, up: 0, down: 0, boost: false };
  mgr.getGroundHeight = () => baseY;
  mgr.updateCarLights = () => {};
  mgr.entities = {
    person: { type: 'person', position: { x: 0, y: baseY, z: 0 }, heading: 0, speed: 0, verticalVel: 0 },
    car: {
      type: 'car', position: { x: 0, y: baseY, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0,
      steerAngle: 0, angularVel: 0, pitchVel: 0, rollVel: 0, heaveVel: 0, heaveY: 0, wheelSpin: 0, wheels: [],
      chassisPivot: { rotation: { x: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } }
    }
  };
  return mgr;
}

function simulateApproach(st, mode, approach) {
  const sh = st.shelter;
  const s = sh.len / 4.4;
  // Use only this stop's furniture colliders so neighbouring poles/buildings don't confound the shelter surface check.
  const cols = tram.stopFurnitureColliders([{ ...st, sign: null, machine: null }]);
  const mgr = makeController(cols, sh.y);
  mgr.activeMode = mode;

  // Approach directions in shelter local coords:
  //   back:  start at (0, -4.0), walk/drive +z toward back glass at z = -0.62
  //   left:  start at (-sh.len/2 - 3.5, 0), walk/drive +x toward left glass at x = -2.15*s
  //   right: start at (+sh.len/2 + 3.5, 0), walk/drive -x toward right advert at x = +2.15*s (outer +2.20*s)
  //   front: start at (0.8*s, +4.0), walk/drive -z toward open front / inside shelter (bench ends at x = 1.2*s, z = -0.18;
  //          use lx = 1.5*s so we walk straight into the open side clear of the bench, and lx = 0 to test bench stop)
  const spec = {
    back:  { lx0: 0, lz0: -4.5, dirX: 0, dirZ: 1, targetLocalZ: -0.62 },
    left:  { lx0: -sh.len / 2 - 4.0, lz0: 0, dirX: 1, dirZ: 0, targetLocalX: -2.15 * s },
    right: { lx0: sh.len / 2 + 4.0, lz0: 0, dirX: -1, dirZ: 0, targetLocalX: 2.20 * s },
    frontOpen: { lx0: 1.5 * s, lz0: 4.5, dirX: 0, dirZ: -1, targetLocalZ: -0.62 },
    frontCenter: { lx0: 0, lz0: 4.5, dirX: 0, dirZ: -1, targetLocalZ: -0.18 }
  }[approach];

  const [wx0, wz0] = toWorld(sh.x, sh.z, sh.yaw, spec.lx0, spec.lz0);
  const [wdx, wdz] = toWorld(0, 0, sh.yaw, spec.dirX, spec.dirZ);
  const heading = Math.atan2(wdx, wdz);
  const ent = mgr.entities[mode];
  ent.position.x = wx0;
  ent.position.y = sh.y;
  ent.position.z = wz0;
  ent.heading = heading;
  ent.speed = 0;

  mgr.keys.forward = 1;
  const dt = 0.05;
  const steps = mode === 'person' ? 120 : 80;
  for (let i = 0; i < steps; i++) {
    if (mode === 'person') mgr.updatePerson(dt);
    else mgr.updateCar(dt);
  }
  const [lxEnd, lzEnd] = toLocal(sh.x, sh.z, Math.cos(sh.yaw), Math.sin(sh.yaw), ent.position.x, ent.position.z);
  const clearanceToVisual = spec.targetLocalZ != null
    ? Math.abs(lzEnd - spec.targetLocalZ)
    : Math.abs(lxEnd - spec.targetLocalX);

  return {
    approach,
    mode,
    start: [Number(wx0.toFixed(2)), Number(wz0.toFixed(2))],
    end: [Number(ent.position.x.toFixed(2)), Number(ent.position.z.toFixed(2))],
    localEnd: [Number(lxEnd.toFixed(3)), Number(lzEnd.toFixed(3))],
    clearanceToVisual: Number(clearanceToVisual.toFixed(3)),
    enteredUnderRoof: Math.abs(lxEnd) < sh.len / 2 && lzEnd < 0.8 && lzEnd > -0.62
  };
}

const targetStops = stops.filter((st) => st.shelter && (
  /dworzec zachodni|żniwna/i.test(st.name) ||
  Math.hypot(st.shelter.x - (-1552.6), st.shelter.z - 229.7) < 3
));

const simulations = targetStops.map((st) => ({
  name: st.name,
  kind: st.kind,
  shelter: {
    x: Number(st.shelter.x.toFixed(2)),
    y: Number(st.shelter.y.toFixed(2)),
    z: Number(st.shelter.z.toFixed(2)),
    yaw: Number(st.shelter.yaw.toFixed(4)),
    yawDeg: Number(((st.shelter.yaw * 180) / Math.PI).toFixed(1)),
    len: st.shelter.len
  },
  person: ['back', 'left', 'right', 'frontOpen', 'frontCenter'].map((a) => simulateApproach(st, 'person', a)),
  car: ['back', 'left', 'right', 'frontOpen'].map((a) => simulateApproach(st, 'car', a))
}));

const report = { audit, simulations };

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('=== Stop Furniture Instanced Counts ===');
  for (const [k, v] of Object.entries(audit.instancedCounts)) {
    console.log(`  ${k}: stops=${v.stops}, instanced=${v.instanced}`);
  }
  console.log('\n=== Geometric Audit (Player Height y < 1.9 m) ===');
  for (const kind of ['shelter', 'sign', 'machine']) {
    const r = audit[kind];
    console.log(`\n[${kind}] count=${r.count}, nonOBB=${r.nonObbCount}, aabbMismatches=${r.aabbMismatches}`);
    console.log(`  maxVisualOutsideCollider (walk-through): ${r.maxVisualOutsideCollider.toFixed(3)} m`);
    for (const g of r.worstGaps) {
      console.log(`    gap ${g.gap.toFixed(3)} m at (${g.x.toFixed(2)}, ${g.z.toFixed(2)}) [${g.name} ${g.part}]`);
    }
    console.log(`  maxColliderBeyondVisual (invisible wall): ${r.maxColliderBeyondVisual.toFixed(3)} m`);
    for (const e of r.worstExcesses) {
      console.log(`    excess ${e.excess.toFixed(3)} m at (${e.x.toFixed(2)}, ${e.z.toFixed(2)}) local=(${e.localX.toFixed(2)}, ${e.localZ.toFixed(2)}) [${e.name}]`);
    }
  }
  console.log('\n=== Named Diagonal Shelter Simulations ===');
  for (const sim of simulations) {
    console.log(`\n${sim.name} (${sim.kind}) shelter=(${sim.shelter.x}, ${sim.shelter.z}) yaw=${sim.shelter.yawDeg}° len=${sim.shelter.len} m`);
    for (const p of sim.person) {
      console.log(`  person ${p.approach.padEnd(11)} localEnd=(${p.localEnd[0].toFixed(3)}, ${p.localEnd[1].toFixed(3)}) clearance=${p.clearanceToVisual.toFixed(3)} m entered=${p.enteredUnderRoof}`);
    }
    for (const c of sim.car) {
      console.log(`  car    ${c.approach.padEnd(11)} localEnd=(${c.localEnd[0].toFixed(3)}, ${c.localEnd[1].toFixed(3)}) clearance=${c.clearanceToVisual.toFixed(3)} m entered=${c.enteredUnderRoof}`);
    }
  }
}
