// tests/helpers/three-stub.cjs
// Shared Three.js stub for headless test suites running landmark and world geometry builders.
// Absorbs object transforms, hierarchy and bounding box queries without importing webgpu or canvas dependencies.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  cross(v) { return this.crossVectors(this, v); }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() {
    const l = this.length() || 1;
    return this.multiplyScalar(1 / l);
  }
  fromArray(arr, offset = 0) {
    this.x = arr[offset];
    this.y = arr[offset + 1];
    this.z = arr[offset + 2];
    return this;
  }
  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
}

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  setFromAxisAngle(axis, rad) {
    const half = rad / 2;
    const s = Math.sin(half);
    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = Math.cos(half);
    return this;
  }
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this.x = -vFrom.y; this.y = vFrom.x; this.z = 0; this.w = r;
      } else {
        this.x = 0; this.y = -vFrom.z; this.z = vFrom.y; this.w = r;
      }
    } else {
      this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this.w = r;
    }
    return this.normalize();
  }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= l; this.y /= l; this.z /= l; this.w /= l;
    return this;
  }
  premultiply(q) {
    return this.multiplyQuaternions(q, this);
  }
  multiplyQuaternions(a, b) {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w;
    const qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    return this;
  }
}

class Matrix4 {
  constructor() {
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }
  identity() {
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
    return this;
  }
  compose(position, quaternion, scale) {
    const te = this.elements;
    const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;

    return this;
  }
  multiplyMatrices(a, b) {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];

    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    return this;
  }
}

class Euler {
  constructor(x = 0, y = 0, z = 0, onChange = () => {}) {
    this._x = x; this._y = y; this._z = z; this._onChange = onChange;
  }
  get x() { return this._x; }
  set x(v) { this._x = v; this._onChange(); }
  get y() { return this._y; }
  set y(v) { this._y = v; this._onChange(); }
  get z() { return this._z; }
  set z(v) { this._z = v; this._onChange(); }
  set(x, y, z) { this._x = x; this._y = y; this._z = z; this._onChange(); return this; }
}

class Object3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = new Quaternion();
    this.rotation = new Euler(0, 0, 0, () => {
      const c1 = Math.cos(this.rotation.x / 2), c2 = Math.cos(this.rotation.y / 2), c3 = Math.cos(this.rotation.z / 2);
      const s1 = Math.sin(this.rotation.x / 2), s2 = Math.sin(this.rotation.y / 2), s3 = Math.sin(this.rotation.z / 2);
      this.quaternion.x = s1 * c2 * c3 + c1 * s2 * s3;
      this.quaternion.y = c1 * s2 * c3 - s1 * c2 * s3;
      this.quaternion.z = c1 * c2 * s3 + s1 * s2 * c3;
      this.quaternion.w = c1 * c2 * c3 - s1 * s2 * s3;
    });
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
  }
  add(child) {
    child.parent = this;
    this.children.push(child);
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  updateMatrixWorld(force = false) {
    this.updateMatrix();
    if (!this.parent) {
      this.matrixWorld.elements = [...this.matrix.elements];
    } else {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    for (const child of this.children) {
      child.updateMatrixWorld(force);
    }
  }
  traverse(cb) {
    cb(this);
    for (const child of this.children) child.traverse(cb);
  }
}

class Group extends Object3D {
  constructor() {
    super();
    this.isGroup = true;
  }
}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}
class Float32BufferAttribute extends BufferAttribute {}

class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.boundingBox = null;
    this.vertices = [];
  }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
    if (name === 'position') {
      const arr = attr.array;
      this.vertices = [];
      for (let i = 0; i < arr.length; i += 3) {
        this.vertices.push(new Vector3(arr[i], arr[i + 1], arr[i + 2]));
      }
    }
  }
  computeVertexNormals() {}
  rotateX(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    for (const v of this.vertices) {
      const y = v.y * c - v.z * s;
      const z = v.y * s + v.z * c;
      v.y = y; v.z = z;
    }
    this.computeBoundingBox();
  }
  translate(x, y, z) {
    for (const v of this.vertices) {
      v.x += x; v.y += y; v.z += z;
    }
    this.computeBoundingBox();
  }
  computeBoundingBox() {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const v of this.vertices) {
      if (v.x < min.x) min.x = v.x;
      if (v.y < min.y) min.y = v.y;
      if (v.z < min.z) min.z = v.z;
      if (v.x > max.x) max.x = v.x;
      if (v.y > max.y) max.y = v.y;
      if (v.z > max.z) max.z = v.z;
    }
    this.boundingBox = { min, max };
  }
}

class BoxGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super();
    this.type = 'BoxGeometry';
    this.parameters = { width: w, height: h, depth: d };
    const hw = w / 2, hh = h / 2, hd = d / 2;
    this.vertices = [
      new Vector3(-hw, -hh, -hd), new Vector3(hw, -hh, -hd),
      new Vector3(-hw, hh, -hd), new Vector3(hw, hh, -hd),
      new Vector3(-hw, -hh, hd), new Vector3(hw, -hh, hd),
      new Vector3(-hw, hh, hd), new Vector3(hw, hh, hd)
    ];
    this.computeBoundingBox();
  }
}

class CylinderGeometry extends BufferGeometry {
  constructor(rTop = 1, rBottom = 1, h = 1, segs = 8) {
    super();
    this.type = 'CylinderGeometry';
    this.parameters = { radiusTop: rTop, radiusBottom: rBottom, height: h, radialSegments: segs };
    const hh = h / 2;
    this.vertices = [];
    for (let i = 0; i < segs; i++) {
      const a = (i * 2 * Math.PI) / segs;
      this.vertices.push(new Vector3(Math.cos(a) * rTop, hh, Math.sin(a) * rTop));
      this.vertices.push(new Vector3(Math.cos(a) * rBottom, -hh, Math.sin(a) * rBottom));
    }
    this.computeBoundingBox();
  }
}

class ConeGeometry extends CylinderGeometry {
  constructor(r = 1, h = 1, segs = 8) {
    super(0, r, h, segs);
    this.type = 'ConeGeometry';
  }
}

class PlaneGeometry extends BufferGeometry {
  constructor(w = 1, h = 1) {
    super();
    this.type = 'PlaneGeometry';
    this.parameters = { width: w, height: h };
    const hw = w / 2, hh = h / 2;
    this.vertices = [
      new Vector3(-hw, -hh, 0), new Vector3(hw, -hh, 0),
      new Vector3(-hw, hh, 0), new Vector3(hw, hh, 0)
    ];
    this.computeBoundingBox();
  }
}

class SphereGeometry extends BufferGeometry {
  constructor(r = 1) {
    super();
    this.type = 'SphereGeometry';
    this.parameters = { radius: r };
    this.vertices = [
      new Vector3(-r, 0, 0), new Vector3(r, 0, 0),
      new Vector3(0, -r, 0), new Vector3(0, r, 0),
      new Vector3(0, 0, -r), new Vector3(0, 0, r)
    ];
    this.computeBoundingBox();
  }
}

class Shape {
  constructor(points = []) {
    this.curves = [];
    this.points = points;
  }
}

class ExtrudeGeometry extends BufferGeometry {
  constructor(shape, opts = {}) {
    super();
    this.type = 'ExtrudeGeometry';
    this.parameters = { shape, options: opts };
    const depth = opts.depth || 1;
    this.vertices = [];
    for (const p of shape.points) {
      this.vertices.push(new Vector3(p.x, p.y, 0));
      this.vertices.push(new Vector3(p.x, p.y, depth));
    }
    this.computeBoundingBox();
  }
}

class LatheGeometry extends BufferGeometry {
  constructor(points = [], segs = 12) {
    super();
    this.type = 'LatheGeometry';
    this.parameters = { points, segments: segs };
    this.vertices = [];
    for (const p of points) {
      for (let s = 0; s < segs; s++) {
        const a = (s * 2 * Math.PI) / segs;
        this.vertices.push(new Vector3(Math.cos(a) * p.x, p.y, Math.sin(a) * p.x));
      }
    }
    this.computeBoundingBox();
  }
}

class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min;
    this.max = max;
  }
  set(min, max) {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }
  setFromObject(object) {
    object.updateMatrixWorld(true);
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this.expandByObject(object);
  }
  expandByObject(object) {
    object.traverse((node) => {
      if (node.isMesh && node.geometry) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        for (const v of node.geometry.vertices) {
          const pt = v.clone().applyMatrix4(node.matrixWorld);
          if (pt.x < this.min.x) this.min.x = pt.x;
          if (pt.y < this.min.y) this.min.y = pt.y;
          if (pt.z < this.min.z) this.min.z = pt.z;
          if (pt.x > this.max.x) this.max.x = pt.x;
          if (pt.y > this.max.y) this.max.y = pt.y;
          if (pt.z > this.max.z) this.max.z = pt.z;
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

class MeshStandardNodeMaterial {
  constructor(params = {}) { Object.assign(this, params); }
}

class CanvasTexture {
  constructor() { this.colorSpace = null; }
}

const THREE = {
  Vector3,
  Vector2,
  Quaternion,
  Matrix4,
  Euler,
  Object3D,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  PlaneGeometry,
  SphereGeometry,
  Shape,
  ExtrudeGeometry,
  LatheGeometry,
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  Box3,
  MeshStandardNodeMaterial,
  CanvasTexture,
  SRGBColorSpace: 'srgb'
};

module.exports = { THREE };
