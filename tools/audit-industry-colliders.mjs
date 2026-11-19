// Headless geometric and controller-simulation audit of every industrial structure (chimneys and cooling towers)
// built by js/buildings.js against its player collider(s) and surrounding buildings, roads, rails, and walls.
//
//   node tools/audit-industry-colliders.mjs [--json] [--top N]
//
// Builds the real world (city-config, geodata, city-grid, buildings, road-network, street-details, controllers),
// captures the actual instanced meshes (IndustryCoolingTowers, IndustryChimneys) and geometry profiles from
// buildCityBlocks(), compares each structure's rendered 0-2 m silhouette against its collider(s) for walk-through
// gaps (penetration) and invisible walls (collider outside mesh), drives the real walking player controller and
// taxi/car straight at each structure from 8 directions, and checks for overlaps with buildings, roads, rails, and
// walls/props.
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
  const geometries = [];
  const three = inert();
  three.Vector2 = function (x = 0, y = 0) { return { x, y }; };
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
  three.LatheGeometry = function (points, segments = 12) {
    const g = inert();
    g.kind = 'lathe';
    g.points = points.map((p) => ({ r: p.x, y: p.y }));
    g.segments = segments;
    geometries.push(g);
    return g;
  };
  three.CylinderGeometry = function (radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 8) {
    const g = inert();
    g.kind = 'cylinder';
    g.radiusTop = radiusTop;
    g.radiusBottom = radiusBottom;
    g.height = height;
    g.segments = radialSegments;
    g.translateY = 0;
    g.translate = (_x, y, _z) => { g.translateY += y; };
    geometries.push(g);
    return g;
  };
  three.InstancedMesh = function (geometry, material, count) {
    const matrices = new Array(count);
    return {
      geometry,
      material,
      count,
      instanceMatrix: { clearUpdateRanges() {}, addUpdateRange() {} },
      instanceColor: { clearUpdateRanges() {}, addUpdateRange() {} },
      castShadow: true,
      receiveShadow: true,
      computeBoundingSphere() {},
      setMatrixAt(i, m) { matrices[i] = m; },
      setColorAt() {},
      set name(v) { instances.set(v, { count, matrices, geometry }); }
    };
  };
  return { three, instances, geometries };
}

const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');

const { three, instances } = createThreeStubs();
const gridMod = loadModule(source('city-grid'), {
  imports: {
    'three/webgpu': three,
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './city-config.js': config,
    './geodata.js': { GEO },
    './tsl-materials.js': inert()
  },
  globals: {
    Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array,
    console: { info() {}, warn() {}, log() {} }
  },
  filename: 'city-grid.js'
});

const buildingsMod = loadModule(source('buildings'), {
  imports: {
    'three/webgpu': three,
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    'three/tsl': inert(),
    './balconies.js': inert(),
    './tsl-materials.js': inert(),
    './roofs.js': inert(),
    './city-config.js': config,
    './geodata.js': { GEO },
    './city-grid.js': {
      pavedPlazaRects: [],
      parkTreeSites: [],
      railClearance: gridMod.railClearance,
      sidewalkBlocks: gridMod.sidewalkBlocks || []
    }
  },
  globals: {
    console: { info() {}, log() {}, warn() {} }, document: inert(), Math, Map, Set, WeakMap, Object, Array,
    Number, JSON, Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
  },
  filename: 'buildings.js'
});

const cityBlocks = buildingsMod.buildCityBlocks(three.Group());
const cityGrid = gridMod.buildCityGrid(three.Group(), {
  buildingFootprints: cityBlocks.footprintsByBlock,
  buildingColliders: cityBlocks.colliders
});

const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals: { console: { info() {}, warn() {}, log() {} } },
  filename: 'road-network.js'
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
    './satellite-sites.js': satellites,
    './city-grid.js': {
      pavedPlazaRects: gridMod.pavedPlazaRects || [],
      parkTreeSites: gridMod.parkTreeSites || [],
      parkLampSites: gridMod.parkLampSites || [],
      clearOfRails: gridMod.clearOfRails
    }
  },
  globals: {
    console: { info() {}, log() {}, warn() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
    document: inert()
  },
  filename: 'street-details.js'
});
const { footprints } = details.buildStreetDetails(inert(), {
  buildingColliders: cityBlocks.colliders,
  grid: cityGrid
});
const network = road.buildRoadNetwork([], footprints);

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

// Geometry helpers for rendered silhouettes and colliders.
function toLocal(cx, cz, cs, sn, wx, wz) {
  const dx = wx - cx, dz = wz - cz;
  return [dx * cs - dz * sn, dx * sn + dz * cs];
}

function toWorld(cx, cz, yaw, lx, lz) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
}

// Evaluate normalized radius r(y / height) of a LatheGeometry or CylinderGeometry at world height y.
function geometryRadiusAtY(geo, height, y) {
  const t = Math.max(0, Math.min(1, y / height));
  if (geo.kind === 'lathe') {
    const pts = geo.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.y && t <= b.y) {
        const u = b.y === a.y ? 0 : (t - a.y) / (b.y - a.y);
        return a.r + (b.r - a.r) * u;
      }
    }
    return pts[pts.length - 1].r;
  }
  // CylinderGeometry translated so base is at 0 and top is at 1.
  return geo.radiusBottom + (geo.radiusTop - geo.radiusBottom) * t;
}

// Exact radial distance of an N-sided regular polygon (circumradius R, vertices at theta_k = k * 2*PI / N)
// along ray angle theta from centre. Both LatheGeometry and CylinderGeometry place vertex 0 at (0, y, R)
// or (R*sin, y, R*cos), i.e. spaced by 2*PI / N.
function polygonRadiusAtAngle(circumR, segments, theta) {
  const step = (2 * Math.PI) / segments;
  const half = step * 0.5;
  let rel = ((theta % step) + step) % step;
  if (rel > half) rel = step - rel;
  return circumR * Math.cos(half) / Math.cos(rel);
}

// Distance from world point (wx, wz) to a collider (circle, OBB, or AABB), 0 when inside.
function distToCollider(c, wx, wz) {
  if (c.circle) {
    return Math.max(0, Math.hypot(wx - c.circle.cx, wz - c.circle.cz) - c.circle.r);
  }
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

// Signed/unsigned distance from point (wx, wz) to a regular N-gon centred at (sx, sz) with circumradius R.
// Returns 0 when inside or on boundary, > 0 when outside.
function distToRegularPolygon(sx, sz, circumR, segments, wx, wz) {
  const dx = wx - sx, dz = wz - sz;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) return 0;
  // Inradius = circumR * cos(PI / segments). Exact distance to convex polygon is max over all N edge half-planes.
  const inradius = circumR * Math.cos(Math.PI / segments);
  const step = (2 * Math.PI) / segments;
  // Check vertex-to-vertex edges: outward normal of edge k is at angle (k + 0.5) * step.
  let maxOut = -Infinity;
  // Also compute exact distance to each edge segment for corners.
  let minEdgeDist = Infinity;
  let inside = true;
  for (let k = 0; k < segments; k++) {
    const a0 = k * step;
    const a1 = (k + 1) * step;
    const ax = Math.sin(a0) * circumR, az = Math.cos(a0) * circumR;
    const bx = Math.sin(a1) * circumR, bz = Math.cos(a1) * circumR;
    const midAngle = (k + 0.5) * step;
    const nx = Math.sin(midAngle), nz = Math.cos(midAngle);
    const planeD = dx * nx + dz * nz - inradius;
    if (planeD > 0) inside = false;
    if (planeD > maxOut) maxOut = planeD;
    // Distance to segment [a, b]
    const ex = bx - ax, ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((dx - ax) * ex + (dz - az) * ez) / len2));
    const px = ax + t * ex, pz = az + t * ez;
    const d = Math.hypot(dx - px, dz - pz);
    if (d < minEdgeDist) minEdgeDist = d;
  }
  return inside ? 0 : minEdgeDist;
}

// Match each industrial structure to its instanced mesh matrix and its player collider(s).
const coolingInst = instances.get('IndustryCoolingTowers');
const chimneyInst = instances.get('IndustryChimneys');
const structures = cityBlocks.industryStructures || [];

// Group structures by kind in the same order place() placed them.
const coolingList = structures.filter((s) => s.kind === 'cooling');
const chimneyList = structures.filter((s) => s.kind === 'chimney');

function findStructureColliders(s) {
  // Colliders belonging to this structure: those overlapping its disk and matching its height (or within its footprint).
  return cityBlocks.colliders.filter((c) => {
    const cx = (c.minX + c.maxX) * 0.5;
    const cz = (c.minZ + c.maxZ) * 0.5;
    const dist = Math.hypot(cx - s.x, cz - s.z);
    return dist <= s.radius + 1.0 && Math.abs((c.maxY ?? 0) - s.height) < 1.0;
  });
}

function makeController(colliders, baseY = 0) {
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

const DIRECTIONS = [
  { name: 'N',  angle: 0 },
  { name: 'NE', angle: Math.PI * 0.25 },
  { name: 'E',  angle: Math.PI * 0.5 },
  { name: 'SE', angle: Math.PI * 0.75 },
  { name: 'S',  angle: Math.PI },
  { name: 'SW', angle: Math.PI * 1.25 },
  { name: 'W',  angle: Math.PI * 1.5 },
  { name: 'NW', angle: Math.PI * 1.75 }
];

function simulateApproach(s, cols, geo, mode, dir) {
  const mgr = makeController(cols, 0);
  mgr.activeMode = mode;
  // Start outside the structure's bounding radius + collider + vehicle half-length.
  const startDist = s.radius + 6;
  const sx = s.x + Math.sin(dir.angle) * startDist;
  const sz = s.z + Math.cos(dir.angle) * startDist;
  // Walk/drive straight toward (s.x, s.z): heading points opposite to dir.angle.
  const heading = dir.angle + Math.PI;
  const ent = mgr.entities[mode];
  ent.position.x = sx;
  ent.position.y = 0;
  ent.position.z = sz;
  ent.heading = heading;
  ent.speed = 0;

  mgr.keys.forward = 1;
  const dt = 0.05;
  const steps = mode === 'person' ? 140 : 100;
  let minCenterDist = startDist;
  for (let i = 0; i < steps; i++) {
    if (mode === 'person') mgr.updatePerson(dt);
    else mgr.updateCar(dt);
    const d = Math.hypot(ent.position.x - s.x, ent.position.z - s.z);
    if (d < minCenterDist) minCenterDist = d;
  }
  const endDistFromCenter = Math.hypot(ent.position.x - s.x, ent.position.z - s.z);
  const renderedR0 = s.radius * geometryRadiusAtY(geo, s.height, 0);
  const polyR0 = polygonRadiusAtAngle(renderedR0, geo.segments, dir.angle);
  const distFromSurface = endDistFromCenter - polyR0;
  const bodyHalf = mode === 'person' ? 0.48 : 2.23;
  const gapFromBody = distFromSurface - bodyHalf;
  return {
    dir: dir.name,
    endCenterDist: Number(endDistFromCenter.toFixed(3)),
    minCenterDist: Number(minCenterDist.toFixed(3)),
    renderedRadiusAtAngle: Number(polyR0.toFixed(3)),
    distFromSurface: Number(distFromSurface.toFixed(3)),
    gapFromBody: Number(gapFromBody.toFixed(3)),
    passedThrough: minCenterDist < polyR0
  };
}

function buildLaneSegments(net) {
  const segs = [];
  const shiftAt = net.laneShiftAt;
  for (const e of net.paintEdges || net.edges || []) {
    const span = e.span ?? e.len;
    for (const o of e.lanes || []) {
      const steps = e.laneShift ? Math.max(1, Math.ceil(span / 8)) : 1;
      let ax = e.x0 + e.rx * (o + shiftAt(e, 0));
      let az = e.z0 + e.rz * (o + shiftAt(e, 0));
      for (let k = 1; k <= steps; k++) {
        const s = (span * k) / steps;
        const off = o + shiftAt(e, s);
        const bx = e.x0 + e.dx * s + e.rx * off, bz = e.z0 + e.dz * s + e.rz * off;
        segs.push({ ax, az, bx, bz, name: e.name || e.road || 'lane' });
        ax = bx;
        az = bz;
      }
    }
  }
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const e of net.edges || []) {
    for (const m of e.moves || []) {
      for (let i = 0; i < m.out.length; i++) {
        if (m.out[i] < 0) continue;
        const c = net.connector(e, i, m.to, m.out[i]);
        net.curvePoint(c, 0, p);
        for (let k = 1; k <= 8; k++) {
          const ax = p.x, az = p.z;
          net.curvePoint(c, (c.len * k) / 8, p);
          segs.push({ ax, az, bx: p.x, bz: p.z, name: 'curve' });
        }
      }
    }
  }
  return segs;
}
const laneSegs = buildLaneSegments(network);

// Segment-to-point distance helper for road lanes.
function distToSeg(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const len2 = ex * ex + ez * ez;
  if (len2 === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / len2));
  return Math.hypot(px - (ax + t * ex), pz - (az + t * ez));
}

function checkOverlaps(s, ownCols) {
  const ownSet = new Set(ownCols);
  // 1. Buildings (other colliders in cityBlocks.colliders)
  const buildingHits = [];
  for (const c of cityBlocks.colliders) {
    if (ownSet.has(c)) continue;
    const d = distToCollider(c, s.x, s.z);
    if (d < s.radius) {
      buildingHits.push({ overlap: Number((s.radius - d).toFixed(3)), minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ });
    }
  }
  // 2. Roads (lane segments, half-width 1.8 m)
  let minLaneDist = Infinity;
  let worstLane = null;
  for (const seg of laneSegs) {
    const d = distToSeg(s.x, s.z, seg.ax, seg.az, seg.bx, seg.bz) - 1.8;
    if (d < minLaneDist) { minLaneDist = d; worstLane = seg.name; }
  }
  const roadOverlap = Math.max(0, s.radius - minLaneDist);

  // 3. Rails (gridMod.railClearance with search radius > s.radius + 1.75)
  const searchR = s.radius + 5;
  const railDist = gridMod.railClearance ? gridMod.railClearance(s.x, s.z, searchR) : searchR;
  const railOverlap = Math.max(0, s.radius + 1.75 - railDist);

  // 4. Walls / props (cityGrid.propColliders)
  const propHits = [];
  for (const c of (cityGrid.propColliders || [])) {
    const d = distToCollider(c, s.x, s.z);
    if (d < s.radius) {
      propHits.push({ overlap: Number((s.radius - d).toFixed(3)), kind: c.kind || 'prop' });
    }
  }

  return {
    buildingOverlaps: buildingHits.length,
    roadClearance: Number((minLaneDist - s.radius).toFixed(3)),
    roadOverlap: Number(roadOverlap.toFixed(3)),
    worstLane,
    railCenterDist: Number(railDist.toFixed(3)),
    railOverlap: Number(railOverlap.toFixed(3)),
    propOverlaps: propHits.length
  };
}

const results = [];
const allTyped = [
  ...coolingList.map((s, i) => ({ s, idx: i, inst: coolingInst })),
  ...chimneyList.map((s, i) => ({ s, idx: i, inst: chimneyInst }))
];

for (const { s, idx, inst } of allTyped) {
  const geo = inst.geometry;
  const mat = inst.matrices[idx];
  const cols = findStructureColliders(s);
  const r0 = s.radius * geometryRadiusAtY(geo, s.height, 0);
  const r1 = s.radius * geometryRadiusAtY(geo, s.height, 1);
  const r2 = s.radius * geometryRadiusAtY(geo, s.height, 2);

  // Geometric check at walking height (0-2 m): widest silhouette is at y = 0 (r0).
  // Sample the rendered polygon boundary + interior on a 0.2 m grid (and exact vertices/midpoints).
  let maxPenetration = 0;
  let penetrationPt = null;
  const step = 0.2;
  for (let dx = -r0; dx <= r0 + 1e-6; dx += step) {
    for (let dz = -r0; dz <= r0 + 1e-6; dz += step) {
      const wx = s.x + dx, wz = s.z + dz;
      if (distToRegularPolygon(s.x, s.z, r0, geo.segments, wx, wz) > 1e-6) continue;
      let minD = Infinity;
      for (const c of cols) {
        const d = distToCollider(c, wx, wz);
        if (d < minD) minD = d;
      }
      if (minD > maxPenetration) {
        maxPenetration = minD;
        penetrationPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
      }
    }
  }
  // Also check polygon vertices explicitly.
  for (let k = 0; k < geo.segments; k++) {
    const a = (k * 2 * Math.PI) / geo.segments;
    const wx = s.x + Math.sin(a) * r0;
    const wz = s.z + Math.cos(a) * r0;
    let minD = Infinity;
    for (const c of cols) {
      const d = distToCollider(c, wx, wz);
      if (d < minD) minD = d;
    }
    if (minD > maxPenetration) {
      maxPenetration = minD;
      penetrationPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
    }
  }

  // Gap (invisible wall): sample every collider (with minY < 1.9 and maxY > 0) and measure distance outside rendered silhouette at y = 0.
  let maxGap = 0;
  let gapPt = null;
  let nonCircleCount = 0;
  let aabbMismatches = 0;
  for (const c of cols) {
    if ((c.minY ?? 0) >= 1.9 || (c.maxY ?? 0) <= 0) continue;
    if (c.circle) {
      const { cx, cz, r } = c.circle;
      if (Math.abs(c.minX - (cx - r)) > 1e-6 || Math.abs(c.maxX - (cx + r)) > 1e-6 ||
          Math.abs(c.minZ - (cz - r)) > 1e-6 || Math.abs(c.maxZ - (cz + r)) > 1e-6) {
        aabbMismatches++;
      }
      for (let dx = -r; dx <= r + 1e-6; dx += step) {
        for (let dz = -r; dz <= r + 1e-6; dz += step) {
          if (dx * dx + dz * dz > r * r + 1e-6) continue;
          const wx = cx + dx, wz = cz + dz;
          const d = distToRegularPolygon(s.x, s.z, r0, geo.segments, wx, wz);
          if (d > maxGap) {
            maxGap = d;
            gapPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
          }
        }
      }
      // Also sample the circle perimeter densely so edge midpoints of the polygon are exact.
      for (let k = 0; k < 360; k++) {
        const a = (k * 2 * Math.PI) / 360;
        const wx = cx + Math.sin(a) * r, wz = cz + Math.cos(a) * r;
        const d = distToRegularPolygon(s.x, s.z, r0, geo.segments, wx, wz);
        if (d > maxGap) {
          maxGap = d;
          gapPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
        }
      }
      continue;
    }
    nonCircleCount++;
    const o = c.obb;
    if (!o) {
      for (let wx = c.minX; wx <= c.maxX + 1e-6; wx += step) {
        for (let wz = c.minZ; wz <= c.maxZ + 1e-6; wz += step) {
          const d = distToRegularPolygon(s.x, s.z, r0, geo.segments, wx, wz);
          if (d > maxGap) {
            maxGap = d;
            gapPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
          }
        }
      }
    } else {
      const ex = Math.abs(o.cs) * o.hx + Math.abs(o.sn) * o.hz;
      const ez = Math.abs(o.sn) * o.hx + Math.abs(o.cs) * o.hz;
      if (Math.abs(c.minX - (o.cx - ex)) > 1e-6 || Math.abs(c.maxX - (o.cx + ex)) > 1e-6 ||
          Math.abs(c.minZ - (o.cz - ez)) > 1e-6 || Math.abs(c.maxZ - (o.cz + ez)) > 1e-6) {
        aabbMismatches++;
      }
      const yaw = Math.atan2(o.sn, o.cs);
      for (let lx = -o.hx; lx <= o.hx + 1e-6; lx += step) {
        for (let lz = -o.hz; lz <= o.hz + 1e-6; lz += step) {
          const [wx, wz] = toWorld(o.cx, o.cz, yaw, lx, lz);
          const d = distToRegularPolygon(s.x, s.z, r0, geo.segments, wx, wz);
          if (d > maxGap) {
            maxGap = d;
            gapPt = { x: Number(wx.toFixed(2)), z: Number(wz.toFixed(2)) };
          }
        }
      }
    }
  }

  const personSim = DIRECTIONS.map((dir) => simulateApproach(s, cols, geo, 'person', dir));
  const carSim = DIRECTIONS.map((dir) => simulateApproach(s, cols, geo, 'car', dir));
  const overlaps = checkOverlaps(s, cols);

  results.push({
    site: s.site || (s.kind === 'chimney' ? 'OSM chimney' : 'OSM cooling'),
    kind: s.kind,
    x: Number(s.x.toFixed(2)),
    z: Number(s.z.toFixed(2)),
    radius: s.radius,
    height: s.height,
    instancedMatrix: mat ? { px: Number(mat.px.toFixed(2)), pz: Number(mat.pz.toFixed(2)), sx: mat.sx, sy: mat.sy } : null,
    segments: geo.segments,
    renderedRadiusProfile: {
      y0: Number(r0.toFixed(3)),
      y1: Number(r1.toFixed(3)),
      y2: Number(r2.toFixed(3)),
      inradiusY0: Number((r0 * Math.cos(Math.PI / geo.segments)).toFixed(3))
    },
    colliderCount: cols.length,
    nonCircleCount,
    aabbMismatches,
    colliders: cols.map((c) => ({
      minX: Number(c.minX.toFixed(3)), maxX: Number(c.maxX.toFixed(3)),
      minZ: Number(c.minZ.toFixed(3)), maxZ: Number(c.maxZ.toFixed(3)),
      minY: c.minY ?? 0, maxY: c.maxY,
      circle: c.circle ? { cx: Number(c.circle.cx.toFixed(3)), cz: Number(c.circle.cz.toFixed(3)), r: Number(c.circle.r.toFixed(3)) } : null,
      obb: c.obb ? { cx: Number(c.obb.cx.toFixed(3)), cz: Number(c.obb.cz.toFixed(3)), hx: Number(c.obb.hx.toFixed(3)), hz: Number(c.obb.hz.toFixed(3)), cs: Number(c.obb.cs.toFixed(4)), sn: Number(c.obb.sn.toFixed(4)) } : null
    })),
    maxGap: Number(maxGap.toFixed(3)),
    gapPt,
    maxPenetration: Number(maxPenetration.toFixed(3)),
    penetrationPt,
    personSim,
    carSim,
    overlaps
  });
}

const report = {
  instancedCounts: {
    cooling: { structures: coolingList.length, instanced: coolingInst?.count ?? 0 },
    chimneys: { structures: chimneyList.length, instanced: chimneyInst?.count ?? 0 }
  },
  structures: results
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('=== Industrial Structures Instanced Counts ===');
  console.log(`  cooling: structures=${report.instancedCounts.cooling.structures}, instanced=${report.instancedCounts.cooling.instanced}`);
  console.log(`  chimneys: structures=${report.instancedCounts.chimneys.structures}, instanced=${report.instancedCounts.chimneys.instanced}`);
  for (const r of results) {
    console.log(`\n--- ${r.site} (${r.kind}) at (${r.x}, ${r.z}), R=${r.radius} m, H=${r.height} m, ${r.segments}-gon ---`);
    console.log(`  Rendered radius profile: y=0: ${r.renderedRadiusProfile.y0} m (inradius ${r.renderedRadiusProfile.inradiusY0} m), y=1: ${r.renderedRadiusProfile.y1} m, y=2: ${r.renderedRadiusProfile.y2} m`);
    console.log(`  Colliders (${r.colliderCount}, nonCircle=${r.nonCircleCount}, aabbMismatches=${r.aabbMismatches}):`);
    for (const c of r.colliders) {
      const tag = c.circle
        ? `CIRCLE cx=${c.circle.cx} cz=${c.circle.cz} r=${c.circle.r}`
        : c.obb ? `OBB cx=${c.obb.cx} cz=${c.obb.cz} hx=${c.obb.hx} hz=${c.obb.hz}` : `AABB [${c.minX}, ${c.maxX}] x [${c.minZ}, ${c.maxZ}]`;
      console.log(`    ${tag} y=[${c.minY}, ${c.maxY}]`);
    }
    console.log(`  Geometric check (0-2 m): maxGap (invisible wall)=${r.maxGap.toFixed(3)} m at (${r.gapPt?.x}, ${r.gapPt?.z}), maxPenetration (mesh outside)=${r.maxPenetration.toFixed(3)} m at (${r.penetrationPt?.x}, ${r.penetrationPt?.z})`);
    console.log(`  Overlaps: buildings=${r.overlaps.buildingOverlaps}, roadClearance=${r.overlaps.roadClearance} m (${r.overlaps.worstLane}), railCenterDist=${r.overlaps.railCenterDist} m (overlap=${r.overlaps.railOverlap} m), props=${r.overlaps.propOverlaps}`);
    console.log('  Controller 8-dir person (radius 0.48 m):');
    for (const p of r.personSim) {
      console.log(`    ${p.dir.padEnd(2)} endDist=${p.endCenterDist.toFixed(3)} m, polyR=${p.renderedRadiusAtAngle.toFixed(3)} m, surfDist=${p.distFromSurface.toFixed(3)} m, gapFromBody=${p.gapFromBody.toFixed(3)} m, passThrough=${p.passedThrough}`);
    }
    console.log('  Controller 8-dir car (half-len 2.23 m):');
    for (const c of r.carSim) {
      console.log(`    ${c.dir.padEnd(2)} endDist=${c.endCenterDist.toFixed(3)} m, polyR=${c.renderedRadiusAtAngle.toFixed(3)} m, surfDist=${c.distFromSurface.toFixed(3)} m, gapFromBody=${c.gapFromBody.toFixed(3)} m, passThrough=${c.passedThrough}`);
    }
  }
}

const hasDefect = results.some((r) =>
  r.maxGap > 0.1 ||
  r.maxPenetration > 0.1 ||
  r.nonCircleCount > 0 ||
  r.aabbMismatches > 0 ||
  r.overlaps.buildingOverlaps > 0 ||
  r.overlaps.roadOverlap > 0 ||
  r.overlaps.railOverlap > 0 ||
  r.overlaps.propOverlaps > 0 ||
  r.personSim.some((p) => p.passedThrough) ||
  r.carSim.some((c) => c.passedThrough)
);
if (hasDefect) process.exitCode = 1;
