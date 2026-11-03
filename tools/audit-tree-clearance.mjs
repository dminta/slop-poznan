// tools/audit-tree-clearance.mjs
// Headless audit of tree clearance against building and landmark colliders.
// Usage: node tools/audit-tree-clearance.mjs [--top N] [--json]

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

// Minimal Three.js mock supporting mesh hierarchy, transforms, bounding box computation for landmark fitting
class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divide(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length(); if (l > 0) this.multiplyScalar(1 / l); return this; }
  fromArray(arr, offset = 0) { this.x = arr[offset]; this.y = arr[offset + 1]; this.z = arr[offset + 2]; return this; }
  cross(v) { return this.crossVectors(this, v); }
  crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z, e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
}
class Matrix4 {
  constructor() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  identity() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; return this; }
  compose(pos, quat, scale) {
    const te = this.elements;
    const x = quat.x, y = quat.y, z = quat.z, w = quat.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    te[0] = (1 - (yy + zz)) * sx; te[1] = (xy + wz) * sx; te[2] = (xz - wy) * sx; te[3] = 0;
    te[4] = (xy - wz) * sy; te[5] = (1 - (xx + zz)) * sy; te[6] = (yz + wx) * sy; te[7] = 0;
    te[8] = (xz + wy) * sz; te[9] = (yz - wx) * sz; te[10] = (1 - (xx + yy)) * sz; te[11] = 0;
    te[12] = pos.x; te[13] = pos.y; te[14] = pos.z; te[15] = 1;
    return this;
  }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        te[i + j * 4] = ae[i] * be[j * 4] + ae[i + 4] * be[j * 4 + 1] + ae[i + 8] * be[j * 4 + 2] + ae[i + 12] * be[j * 4 + 3];
      }
    }
    return this;
  }
  makeBasis(xAxis, yAxis, zAxis) {
    const te = this.elements;
    te[0] = xAxis.x; te[1] = xAxis.y; te[2] = xAxis.z; te[3] = 0;
    te[4] = yAxis.x; te[5] = yAxis.y; te[6] = yAxis.z; te[7] = 0;
    te[8] = zAxis.x; te[9] = zAxis.y; te[10] = zAxis.z; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }
  setPosition(x, y, z) {
    const te = this.elements;
    if (x && typeof x === 'object') {
      te[12] = x.x; te[13] = x.y; te[14] = x.z;
    } else {
      te[12] = x; te[13] = y; te[14] = z;
    }
    return this;
  }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromAxisAngle(axis, rad) {
    const half = rad / 2, s = Math.sin(half);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(half);
    return this;
  }
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) { this.x = -vFrom.y; this.y = vFrom.x; this.z = 0; this.w = r; }
      else { this.x = 0; this.y = -vFrom.z; this.z = vFrom.y; this.w = r; }
    } else {
      this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this.w = r;
    }
    return this.normalize();
  }
  normalize() {
    let l = Math.hypot(this.x, this.y, this.z, this.w);
    if (l === 0) { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
    else { this.x /= l; this.y /= l; this.z /= l; this.w /= l; }
    return this;
  }
  premultiply(q) {
    const qax = q.x, qay = q.y, qaz = q.z, qaw = q.w;
    const qbx = this.x, qby = this.y, qbz = this.z, qbw = this.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qbx + qaz * qby - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qbz - qaz * qby;
    return this;
  }
  makeBasis(xAxis, yAxis, zAxis) {
    const te = this.elements;
    te[0] = xAxis.x; te[1] = xAxis.y; te[2] = xAxis.z; te[3] = 0;
    te[4] = yAxis.x; te[5] = yAxis.y; te[6] = yAxis.z; te[7] = 0;
    te[8] = zAxis.x; te[9] = zAxis.y; te[10] = zAxis.z; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }
  setPosition(x, y, z) {
    const te = this.elements;
    if (x && typeof x === 'object') {
      te[12] = x.x; te[13] = x.y; te[14] = x.z;
    } else {
      te[12] = x; te[13] = y; te[14] = z;
    }
    return this;
  }
}
class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = new Quaternion();
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.children = [];
    this.parent = null;
  }
  add(...objs) {
    for (const o of objs) {
      if (o.parent) o.removeFromParent();
      o.parent = this;
      this.children.push(o);
    }
  }
  removeFromParent() {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) this.parent.children.splice(idx, 1);
      this.parent = null;
    }
  }
  updateMatrix() {
    if (this.rotation.y !== 0 && this.quaternion.y === 0 && this.quaternion.w === 1) {
      this.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), this.rotation.y);
    }
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  updateMatrixWorld(force) {
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.elements = [...this.matrix.elements];
    for (const c of this.children) c.updateMatrixWorld(force);
  }
  traverse(cb) {
    cb(this);
    for (const c of this.children) c.traverse(cb);
  }
}
class Group extends Object3D {}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}
class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.count = count;
    this.instanceMatrix = new BufferAttribute(new Float32Array(count * 16), 16);
  }
  setMatrixAt() {}
  computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
}
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.boundingBox = null;
    this.parameters = {};
  }
  clone() { return this; }
  applyMatrix4() { return this; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  computeVertexNormals() {}
  computeBoundingBox() {
    if (this.boundingBox) return;
    const pos = this.attributes.position;
    if (!pos) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.array.length; i += 3) {
      const x = pos.array[i], y = pos.array[i + 1], z = pos.array[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.boundingBox = { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) };
  }
  rotateX() { return this; }
  translate() { return this; }
}
class BoxGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super();
    this.parameters = { width: w, height: h, depth: d };
    this.boundingBox = { min: new Vector3(-w / 2, -h / 2, -d / 2), max: new Vector3(w / 2, h / 2, d / 2) };
  }
}
class CylinderGeometry extends BufferGeometry {
  constructor(rt = 1, rb = 1, h = 1) {
    super();
    const r = Math.max(rt, rb);
    this.boundingBox = { min: new Vector3(-r, -h / 2, -r), max: new Vector3(r, h / 2, r) };
  }
}
class ConeGeometry extends CylinderGeometry {
  constructor(r = 1, h = 1) { super(0, r, h); }
}
class SphereGeometry extends BufferGeometry {
  constructor(r = 1) {
    super();
    this.boundingBox = { min: new Vector3(-r, -r, -r), max: new Vector3(r, r, r) };
  }
}
class PlaneGeometry extends BufferGeometry {
  constructor(w = 1, h = 1) {
    super();
    this.boundingBox = { min: new Vector3(-w / 2, -h / 2, 0), max: new Vector3(w / 2, h / 2, 0) };
  }
}
class LatheGeometry extends BufferGeometry {
  constructor(pts) {
    super();
    let maxR = 0, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x > maxR) maxR = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.boundingBox = { min: new Vector3(-maxR, minY, -maxR), max: new Vector3(maxR, maxY, maxR) };
  }
}
class ExtrudeGeometry extends BufferGeometry {
  constructor(shape, opts = {}) {
    super();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of shape.points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const d = opts.depth || 1;
    this.boundingBox = { min: new Vector3(minX, minY, 0), max: new Vector3(maxX, maxY, d) };
  }
}
class Shape {
  constructor(points = []) { this.points = points; this.holes = []; }
}
class Path {
  constructor(points = []) { this.points = points; }
}
class Box3 {
  constructor() {
    this.min = new Vector3(Infinity, Infinity, Infinity);
    this.max = new Vector3(-Infinity, -Infinity, -Infinity);
  }
  setFromObject(obj) {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this.expandByObject(obj);
  }
  expandByPoint(p) {
    this.min.x = Math.min(this.min.x, p.x);
    this.min.y = Math.min(this.min.y, p.y);
    this.min.z = Math.min(this.min.z, p.z);
    this.max.x = Math.max(this.max.x, p.x);
    this.max.y = Math.max(this.max.y, p.y);
    this.max.z = Math.max(this.max.z, p.z);
  }
  expandByObject(object) {
    object.traverse((node) => {
      const geo = node.geometry;
      if (geo) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (geo.boundingBox) {
          const b = geo.boundingBox;
          const corners = [
            new Vector3(b.min.x, b.min.y, b.min.z), new Vector3(b.min.x, b.min.y, b.max.z),
            new Vector3(b.min.x, b.max.y, b.min.z), new Vector3(b.min.x, b.max.y, b.max.z),
            new Vector3(b.max.x, b.min.y, b.min.z), new Vector3(b.max.x, b.min.y, b.max.z),
            new Vector3(b.max.x, b.max.y, b.min.z), new Vector3(b.max.x, b.max.y, b.max.z)
          ];
          for (const c of corners) {
            c.applyMatrix4(node.matrixWorld);
            this.expandByPoint(c);
          }
        }
      }
    });
    return this;
  }
  getSize(target) {
    return target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z);
  }
  getCenter(target) {
    return target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
  }
}

const mockTHREE = {
  Vector2, Vector3, Matrix4, Quaternion, Euler, Object3D, Group, Mesh, InstancedMesh,
  BufferAttribute, Float32BufferAttribute: BufferAttribute, BufferGeometry,
  BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, PlaneGeometry,
  LatheGeometry, ExtrudeGeometry, Shape, Path, Box3,
  MeshStandardNodeMaterial: class {}
};

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_t, key, value) { values[key] = value; return true; },
    apply: () => inert(), construct: () => inert()
  });
}

async function runAudit() {
  const startTime = Date.now();
  console.log('1. Loading configurations and building world models...');
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const stub = inert();
  const globals = {
    console: { info() {}, warn() {}, log() {} },
    Math, Map, Set, WeakMap, Object, Array, Number, JSON,
    Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
  };
  const gridRendering = {
    'three/webgpu': stub,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub,
    './tsl-materials.js': stub
  };
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
  const landmarkRendering = {
    'three/webgpu': mockTHREE,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub,
    './tsl-materials.js': materialsStub
  };

  // Step 1: City Grid
  let gridSrc = source('city-grid');
  gridSrc = gridSrc.replace('treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species });',
    'treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species, source: "plaza planters" });');
  gridSrc = gridSrc.replace('treeSites.push({ x: tx, y: BED_Y, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });',
    'treeSites.push({ x: tx, y: BED_Y, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2), source: "park sites" });');
  gridSrc = gridSrc.replace('treeSites.push({ x: tx, y: SW_TOP, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });',
    'treeSites.push({ x: tx, y: SW_TOP, z: tz, scale, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2), source: "park sites" });');
  gridSrc += '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }';

  const gridModule = loadModule(gridSrc, {
    imports: { ...gridRendering, './city-config.js': config, './geodata.js': { GEO } }, globals
  });
  const cityGridBuilt = gridModule.buildCityGrid(stub);
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };

  // Step 2: Landmarks
  console.log('2. Building landmarks with full oriented colliders...');
  const siteNames = new Map(Object.entries(config.LANDMARK_SITES).map(([name, s]) => [s, name]));
  const kit = loadModule(source('landmark-kit'), { imports: { ...landmarkRendering, './city-config.js': config }, globals });
  const clock = loadModule(source('city-clock'), { imports: {}, globals });
  const lms = loadModule(source('landmarks'), {
    imports: {
      ...landmarkRendering, './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { batchStaticGroupMeshes: () => {} },
      './landmark-kit.js': kit,
      './landmarks-rynek.js': loadModule(source('landmarks-rynek'), { imports: { ...landmarkRendering, './city-config.js': config, './landmark-kit.js': kit, './city-clock.js': clock }, globals }),
      './landmarks-heritage.js': loadModule(source('landmarks-heritage'), { imports: { ...landmarkRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-centrum.js': loadModule(source('landmarks-centrum'), { imports: { ...landmarkRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-dworzec.js': loadModule(source('landmarks-dworzec'), { imports: { ...landmarkRendering, './city-config.js': config, './landmark-kit.js': kit }, globals }),
      './landmarks-towers.js': loadModule(source('landmarks-towers'), { imports: { ...landmarkRendering, './city-config.js': config, './landmark-kit.js': kit }, globals })
    },
    globals
  });
  const landmarksBuilt = lms.buildLandmarks(new Group());
  const landmarkColliders = landmarksBuilt.colliders;

  // Step 3: Generic city blocks (buildings)
  console.log('3. Building city blocks with building colliders...');
  let bldSrc = source('buildings');
  // Tag leftover slabs if any
  bldSrc = bldSrc.replace('sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });',
    'sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1, source: "leftover slabs" });');
  // Record profile on blockDetail
  bldSrc = bldSrc.replace(
    'const profile = steerProfile(blockProfile(blockDetail, district), srcBlock);',
    'const profile = steerProfile(blockProfile(blockDetail, district), srcBlock); blockDetail.profile = profile;'
  );
  // Instrument pushCollider signature and commit call
  bldSrc = bldSrc.replace(
    'function pushCollider(x0, x1, z0, z1, minY, maxY) {',
    'function pushCollider(x0, x1, z0, z1, minY, maxY, kind = "generic", district = "") {'
  );
  bldSrc = bldSrc.replace(
    'colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY, maxY });',
    'colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY, maxY, kind, district });'
  );
  bldSrc = bldSrc.replace(
    'colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs: xf.cs, sn: xf.sn } });',
    'colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs: xf.cs, sn: xf.sn }, kind, district });'
  );
  bldSrc = bldSrc.replace(
    'pushCollider(p.x0, p.x1, p.z0, p.z1, p.y0, p.y1);',
    'pushCollider(p.x0, p.x1, p.z0, p.z1, p.y0, p.y1, blk.profile?.kind || "generic", blk.district);'
  );

  const bldMod = loadModule(bldSrc, {
    imports: {
      ...gridRendering,
      './balconies.js': stub,
      './roofs.js': stub,
      './city-config.js': config,
      './geodata.js': { GEO },
      './city-grid.js': liveGrid
    },
    globals: { ...globals, document: stub },
    filename: 'buildings.js'
  });
  const cityBlocksBuilt = bldMod.buildCityBlocks(stub);
  const blockColliders = cityBlocksBuilt.colliders;

  // Step 3B: Bridges
  console.log('3B. Building bridges with colliders...');
  const bridgesBuilt = loadModule(source('bridges'), {
    imports: { ...landmarkRendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { ...globals, performance: { now: () => Date.now() } }
  }).buildBridges(new Group());
  const bridgeColliders = bridgesBuilt.colliders || [];
  for (const c of bridgeColliders) c.kind = 'Bridge';

  // Assign landmark names to landmark colliders based on proximity to landmark sites / SRODKA_MURAL
  for (const c of landmarkColliders) {
    c.isLandmark = true;
    let closestSite = 'Landmark';
    let minDist = Infinity;
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) * 0.5;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) * 0.5;
    const sm = config.SRODKA_MURAL;
    if (sm && Math.hypot(cx - sm.cx, cz - sm.cz) < 25) {
      closestSite = 'SRODKA_MURAL';
    } else {
      for (const [name, site] of Object.entries(config.LANDMARK_SITES)) {
        const d = Math.hypot(cx - site.x, cz - site.z);
        if (d < minDist) { minDist = d; closestSite = name; }
      }
    }
    c.kind = closestSite;
  }

  const allBuildingColliders = [...landmarkColliders, ...blockColliders, ...bridgeColliders];
  console.log(`Colliders: ${landmarkColliders.length} landmark + ${blockColliders.length} building + ${bridgeColliders.length} bridge = ${allBuildingColliders.length} total.`);

  // Step 4: Street details (trees)
  console.log('4. Building street trees and collecting all tree sites...');
  let sites = [];
  let streetSrc = source('street-details');
  streetSrc = streetSrc.replace(
    /addStreetTree\(x, z, scale, species, acrossX, \{[\s\S]*?\}\);/,
    'addStreetTree(x, z, scale, species, acrossX, { tier, pitRot, grate: !narrow, pitS: narrow ? 0.7 : 1, squeeze, source: narrow ? "street trees narrow" : "street trees wide" });'
  );

  loadModule(streetSrc, {
    imports: {
      ...gridRendering,
      './city-config.js': config,
      './road-network.js': { CROSSWALK: 4.3, CROSSWALK_REACH: 3, STOP_SETBACK: 1.5 },
      './city-grid.js': liveGrid,
      './trees.js': {
        createTreeField: (_scene, trees) => { sites = trees; return { group: stub }; },
        SPECIES_CROWN_R: [4.53, 4.74, 6.07, 4.55]
      }
    },
    globals: { ...globals, document: stub }
  }).buildStreetDetails(stub, { buildingColliders: allBuildingColliders, grid: cityGridBuilt });

  const keptColliders = new Set(sites.map((s) => s.collider).filter(Boolean));
  const remainingTrunkColliders = cityGridBuilt.propColliders.filter((c) => c.isTrunk);
  let orphanCount = 0;
  for (const c of remainingTrunkColliders) {
    if (!keptColliders.has(c)) orphanCount++;
  }
  console.log(`Park tree trunk colliders: ${remainingTrunkColliders.length}, orphans: ${orphanCount}`);
  assert.equal(orphanCount, 0, 'every remaining tree trunk prop collider has a tree site');

  const { treeSpecies } = loadModule(source('trees'), {
    imports: { 'three/webgpu': stub, './tsl-materials.js': stub },
    globals
  });

  console.log(`Trees collected: ${sites.length} total.`);

  // Step 5: Build 2D Spatial Hash Grid for fast collider lookup
  console.log('5. Building spatial index for colliders...');
  const CELL_SIZE = 32;
  const grid = new Map();
  const getCellKey = (ix, iz) => `${ix},${iz}`;

  for (let ci = 0; ci < allBuildingColliders.length; ci++) {
    const c = allBuildingColliders[ci];
    c._id = ci;
    const ix0 = Math.floor(c.minX / CELL_SIZE);
    const ix1 = Math.floor(c.maxX / CELL_SIZE);
    const iz0 = Math.floor(c.minZ / CELL_SIZE);
    const iz1 = Math.floor(c.maxZ / CELL_SIZE);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = getCellKey(ix, iz);
        let list = grid.get(k);
        if (!list) { list = []; grid.set(k, list); }
        list.push(c);
      }
    }
  }

  // Exact distance from tree t to collider c (AABB or OBB), respecting height band
  function distToCollider(t, c) {
    const treeY = t.y || 0.22;
    const topY = treeY + 14.0 * t.scale;
    if ((c.maxY !== undefined && c.maxY < treeY) || (c.minY !== undefined && c.minY > topY)) {
      return Infinity;
    }
    const tx = t.x, tz = t.z;
    const o = c.obb;
    const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
    const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
    const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
    const dx = tx - (o ? o.cx : (c.minX + c.maxX) * 0.5);
    const dz = tz - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const ax = Math.abs(lx);
    const az = Math.abs(lz);
    if (ax <= hx && az <= hz) {
      // Trunk inside footprint: negative distance to nearest wall edge
      return -Math.min(hx - ax, hz - az);
    }
    const clx = Math.max(0, ax - hx);
    const clz = Math.max(0, az - hz);
    return Math.hypot(clx, clz);
  }

  // Base crown radius from trees.js SPECIES models (half-extents of foliage crown)
  // lime: 4.53 m, maple: 4.74 m, chestnut: 6.07 m, robinia: 4.55 m
  const SPECIES_CROWN_R = [4.53, 4.74, 6.07, 4.55];
  const SPECIES_NAMES = ['lime', 'maple', 'chestnut', 'robinia'];

  console.log('6. Evaluating all trees against nearest collider wall...');
  const evaluated = [];
  const SEARCH_RAD = 16;
  const radCells = Math.ceil(SEARCH_RAD / CELL_SIZE);

  let visitedColliders = new Uint8Array(allBuildingColliders.length);
  let visitedList = [];

  for (let i = 0; i < sites.length; i++) {
    const t = sites[i];
    const source = t.source || 'other';
    const assignedSpecies = treeSpecies(t);
    const speciesName = SPECIES_NAMES[assignedSpecies];
    const squeeze = t.squeeze || (t.sx && t.sz ? Math.min(t.sx, t.sz) : (t.sx || t.sz || 1));
    const crownR = SPECIES_CROWN_R[assignedSpecies] * t.scale * squeeze;
    const crownR_unsqueezed = SPECIES_CROWN_R[assignedSpecies] * t.scale;

    const cix = Math.floor(t.x / CELL_SIZE);
    const ciz = Math.floor(t.z / CELL_SIZE);

    let minDist = Infinity;
    let nearestCollider = null;

    for (let dx = -radCells; dx <= radCells; dx++) {
      for (let dz = -radCells; dz <= radCells; dz++) {
        const k = getCellKey(cix + dx, ciz + dz);
        const cell = grid.get(k);
        if (!cell) continue;
        for (let j = 0; j < cell.length; j++) {
          const c = cell[j];
          if (visitedColliders[c._id] === 1) continue;
          visitedColliders[c._id] = 1;
          visitedList.push(c._id);

          const d = distToCollider(t, c);
          if (d < minDist) {
            minDist = d;
            nearestCollider = c;
          }
        }
      }
    }

    // Reset visited
    for (let v = 0; v < visitedList.length; v++) visitedColliders[visitedList[v]] = 0;
    visitedList.length = 0;

    const isInside = minDist <= 0;
    const crownOverlap = crownR - minDist;
    const crownIntersects = crownOverlap > 0;

    evaluated.push({
      tree: t,
      source,
      species: assignedSpecies,
      speciesName,
      scale: t.scale,
      squeeze,
      crownR,
      crownR_unsqueezed,
      dist: minDist,
      crownOverlap,
      crownIntersects,
      collider: nearestCollider
    });
  }

  console.log(`Evaluated ${evaluated.length} trees in ${((Date.now() - startTime) / 1000).toFixed(1)} s.`);

  // Step 6: Bucket Counts
  const sources = ['street trees narrow', 'street trees wide', 'park sites', 'plaza planters', 'leftover slabs'];
  const summaryBySource = {};
  for (const src of sources) {
    summaryBySource[src] = {
      total: 0,
      inside: 0,
      under1m: 0,
      m1to2: 0,
      m2to3: 0,
      m3to5: 0,
      over5m: 0,
      crownIntersects: 0
    };
  }
  const citySummary = {
    total: 0,
    inside: 0,
    under1m: 0,
    m1to2: 0,
    m2to3: 0,
    m3to5: 0,
    over5m: 0,
    crownIntersects: 0
  };

  for (const e of evaluated) {
    const s = summaryBySource[e.source];
    if (!s) continue;
    s.total++;
    citySummary.total++;

    const d = e.dist;
    if (d <= 0) { s.inside++; citySummary.inside++; }
    else if (d < 1) { s.under1m++; citySummary.under1m++; }
    else if (d < 2) { s.m1to2++; citySummary.m1to2++; }
    else if (d < 3) { s.m2to3++; citySummary.m2to3++; }
    else if (d < 5) { s.m3to5++; citySummary.m3to5++; }
    else { s.over5m++; citySummary.over5m++; }

    if (e.crownIntersects) {
      s.crownIntersects++;
      citySummary.crownIntersects++;
    }
  }

  // Print Summary Table
  console.log('\n========================================================================================');
  console.log('SUMMARY TABLE: TREE-BUILDING CLEARANCE BY SOURCE AND DISTANCE BUCKET');
  console.log('========================================================================================');
  console.log(
    'Source'.padEnd(22) +
    'Total'.padStart(8) +
    'Inside (<=0)'.padStart(14) +
    '< 1 m'.padStart(10) +
    '1–2 m'.padStart(10) +
    '2–3 m'.padStart(10) +
    '3–5 m'.padStart(10) +
    '> 5 m'.padStart(10) +
    'Crown Wall Overlap'.padStart(20)
  );
  console.log('-'.repeat(124));

  for (const src of sources) {
    const s = summaryBySource[src];
    console.log(
      src.padEnd(22) +
      s.total.toString().padStart(8) +
      s.inside.toString().padStart(14) +
      s.under1m.toString().padStart(10) +
      s.m1to2.toString().padStart(10) +
      s.m2to3.toString().padStart(10) +
      s.m3to5.toString().padStart(10) +
      s.over5m.toString().padStart(10) +
      s.crownIntersects.toString().padStart(20)
    );
  }
  console.log('-'.repeat(124));
  console.log(
    'CITY TOTAL'.padEnd(22) +
    citySummary.total.toString().padStart(8) +
    citySummary.inside.toString().padStart(14) +
    citySummary.under1m.toString().padStart(10) +
    citySummary.m1to2.toString().padStart(10) +
    citySummary.m2to3.toString().padStart(10) +
    citySummary.m3to5.toString().padStart(10) +
    citySummary.over5m.toString().padStart(10) +
    citySummary.crownIntersects.toString().padStart(20)
  );

  // Worst Examples: sorted by distance ascending (most negative / deepest inside building)
  evaluated.sort((a, b) => a.dist - b.dist);
  console.log('\n========================================================================================');
  console.log('WORST EXAMPLES (DEEPEST PENETRATION INTO BUILDING / LANDMARK)');
  console.log('========================================================================================');
  const worstInside = evaluated.slice(0, 10);
  worstInside.forEach((e, idx) => {
    const c = e.collider;
    const kindStr = c ? (c.isLandmark ? `Landmark: ${c.kind}` : `Building: ${c.kind || 'generic'}`) : 'Unknown';
    console.log(
      `#${idx + 1}: (${e.tree.x.toFixed(1)}, ${e.tree.z.toFixed(1)}) | dist: ${e.dist.toFixed(2)} m | ` +
      `source: ${e.source} | species: ${e.speciesName} (scale ${e.scale.toFixed(2)}) | ` +
      `crown overlap: ${e.crownOverlap.toFixed(2)} m | hits: ${kindStr}`
    );
  });

  // Also check worst street trees specifically
  const worstStreet = evaluated.filter((e) => e.source.startsWith('street')).slice(0, 10);
  console.log('\n========================================================================================');
  console.log('WORST STREET TREES (NARROW & WIDE)');
  console.log('========================================================================================');
  worstStreet.forEach((e, idx) => {
    const c = e.collider;
    const kindStr = c ? (c.isLandmark ? `Landmark: ${c.kind}` : `Building: ${c.kind || 'generic'}`) : 'Unknown';
    console.log(
      `#${idx + 1}: (${e.tree.x.toFixed(1)}, ${e.tree.z.toFixed(1)}) | dist: ${e.dist.toFixed(2)} m | ` +
      `source: ${e.source} | species: ${e.speciesName} | hits: ${kindStr}`
    );
  });

  // Step 7: Candidate Policy Threshold Analysis
  console.log('\n========================================================================================');
  console.log('POLICY ANALYSIS: IMPACT OF CANDIDATE MINIMUM TRUNK-TO-WALL CLEARANCE THRESHOLDS');
  console.log('========================================================================================');
  const thresholds = [
    { label: 'Inside only (< 0.0 m)', test: (e) => e.dist < 0.0 },
    { label: 'Threshold >= 1.0 m', test: (e) => e.dist < 1.0 },
    { label: 'Threshold >= 1.5 m', test: (e) => e.dist < 1.5 },
    { label: 'Threshold >= 2.0 m', test: (e) => e.dist < 2.0 },
    { label: 'Threshold >= 2.5 m', test: (e) => e.dist < 2.5 },
    { label: 'Threshold >= 3.0 m', test: (e) => e.dist < 3.0 },
    { label: 'Threshold >= 4.0 m', test: (e) => e.dist < 4.0 },
    { label: 'Full Crown Clearance (dist >= crownR)', test: (e) => e.dist < e.crownR },
    {
      label: 'Tiered (Tier 2/narrow >= 2.0m, Tier 1/wide/park >= 3.0m)',
      test: (e) => e.dist < (e.tree.tier === 2 || e.source === 'street trees narrow' ? 2.0 : 3.0)
    },
    {
      label: 'Tiered (Tier 2/narrow >= 1.5m, Tier 1/wide/park >= 2.5m)',
      test: (e) => e.dist < (e.tree.tier === 2 || e.source === 'street trees narrow' ? 1.5 : 2.5)
    }
  ];

  console.log(
    'Candidate Threshold'.padEnd(55) +
    'Dropped Street Narrow'.padStart(22) +
    'Dropped Street Wide'.padStart(20) +
    'Dropped Parks'.padStart(16) +
    'Total Dropped'.padStart(16) +
    'Share (%)'.padStart(12)
  );
  console.log('-'.repeat(141));

  for (const t of thresholds) {
    let droppedNarrow = 0, droppedWide = 0, droppedPark = 0, droppedPlanter = 0, droppedTotal = 0;
    for (const e of evaluated) {
      if (t.test(e)) {
        droppedTotal++;
        if (e.source === 'street trees narrow') droppedNarrow++;
        else if (e.source === 'street trees wide') droppedWide++;
        else if (e.source === 'park sites') droppedPark++;
        else if (e.source === 'plaza planters') droppedPlanter++;
      }
    }
    const pct = ((droppedTotal / evaluated.length) * 100).toFixed(2);
    console.log(
      t.label.padEnd(55) +
      `${droppedNarrow} (${((droppedNarrow / summaryBySource['street trees narrow'].total) * 100).toFixed(1)}%)`.padStart(22) +
      `${droppedWide} (${((droppedWide / summaryBySource['street trees wide'].total) * 100).toFixed(1)}%)`.padStart(20) +
      `${droppedPark} (${((droppedPark / summaryBySource['park sites'].total) * 100).toFixed(1)}%)`.padStart(16) +
      droppedTotal.toString().padStart(16) +
      `${pct}%`.padStart(12)
    );
  }

  // Check curb shift feasibility
  // For street trees that violate e.g. 2.0 m, check if moving ±1m, ±2m, ±3m along the curb avoids building
  console.log('\n========================================================================================');
  console.log('FEASIBILITY OF SHIFTING STREET TREES ALONG CURB INSTEAD OF DROPPING');
  console.log('========================================================================================');
  // Sample street trees that have dist < 2.0 m
  const streetViolators = evaluated.filter((e) => e.source.startsWith('street') && e.dist < 2.0);
  console.log(`Analyzing ${streetViolators.length} street trees with clearance < 2.0 m...`);

  // To check shifting along curb:
  // Each street tree has pitRot (rotation along curb).
  // A unit shift along curb is: dx_curb = Math.sin(pitRot), dz_curb = Math.cos(pitRot).
  let shiftSaves1m = 0, shiftSaves2m = 0, shiftSaves3m = 0, shiftUnfixable = 0;
  for (const e of streetViolators) {
    const t = e.tree;
    const rot = t.pitRot || 0;
    const cdx = Math.sin(rot), cdz = Math.cos(rot);
    const target = 2.0;

    let fixedAt = 0;
    for (const step of [1.0, -1.0, 2.0, -2.0, 3.0, -3.0]) {
      const sx = t.x + cdx * step;
      const sz = t.z + cdz * step;

      // Quick test distance to all colliders
      const cix = Math.floor(sx / CELL_SIZE), ciz = Math.floor(sz / CELL_SIZE);
      let sDist = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(getCellKey(cix + dx, ciz + dz));
          if (!list) continue;
          for (const c of list) {
            const d = distToCollider({ x: sx, z: sz, y: t.y, scale: t.scale }, c);
            if (d < sDist) sDist = d;
          }
        }
      }
      if (sDist >= target) {
        fixedAt = Math.abs(step);
        break;
      }
    }
    if (fixedAt === 1.0) shiftSaves1m++;
    else if (fixedAt === 2.0) shiftSaves2m++;
    else if (fixedAt === 3.0) shiftSaves3m++;
    else shiftUnfixable++;
  }

  console.log(`Of ${streetViolators.length} street trees needing 2.0 m clearance:`);
  console.log(`  - Rescued by shifting ±1.0 m along curb: ${shiftSaves1m} (${((shiftSaves1m / (streetViolators.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  - Rescued by shifting ±2.0 m along curb: ${shiftSaves2m} (${((shiftSaves2m / (streetViolators.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  - Rescued by shifting ±3.0 m along curb: ${shiftSaves3m} (${((shiftSaves3m / (streetViolators.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  - Unfixable by shift (sidewalk too narrow along run): ${shiftUnfixable} (${((shiftUnfixable / (streetViolators.length || 1)) * 100).toFixed(1)}%) -> must be dropped`);

  assert.equal(citySummary.inside, 0, `Expected 0 trunks inside colliders, found ${citySummary.inside}`);
  assert.equal(citySummary.crownIntersects, 0, `Expected 0 crown overlaps under clearance rule, found ${citySummary.crownIntersects}`);

  return {
    evaluated,
    summaryBySource,
    citySummary,
    worstInside,
    worstStreet
  };
}

export { runAudit };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAudit().then(() => {
    console.log('\nTree clearance regression test passed: 0 trunks inside, 0 crown overlaps.');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
