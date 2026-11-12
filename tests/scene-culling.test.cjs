const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class Matrix4 {
  constructor() { this.elements = new Float32Array(16); }
  multiplyMatrices() { return this; }
  fromArray() { return this; }
}
class Vector3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  fromBufferAttribute() { return this; }
  applyMatrix4() { return this; }
}
const THREE = { Matrix4, Vector3 };
const { chunkCellScale } = loadModule(readFileSync(join(__dirname, '../js/scene-culling.js'), 'utf8'), {
  imports: { 'three/webgpu': THREE },
  globals: { Math, Float32Array, Map },
  filename: 'scene-culling.js'
});

test('cheap props get the coarser culling cells and heavy ones keep the per-instance distance', () => {
  assert.equal(chunkCellScale(2), 2);
  assert.equal(chunkCellScale(12), 2);
  assert.equal(chunkCellScale(40), 2);
  assert.equal(chunkCellScale(41), 1.5);
  assert.equal(chunkCellScale(120), 1.5);
  assert.equal(chunkCellScale(121), 1);
  assert.equal(chunkCellScale(266), 1);
});

// Bounds are supplied by three.js; this stub exercises the production pass hook and the world-space conversion.
// Affine corner expansion covers turned/scaled parents as well as geometry offset from its instance origin.
class Box3 {
  constructor(min, max) { this.min = { ...min }; this.max = { ...max }; }
  clone() { return new Box3(this.min, this.max); }
  applyMatrix4(matrix) {
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const x of [this.min.x, this.max.x]) {
      for (const y of [this.min.y, this.max.y]) {
        for (const z of [this.min.z, this.max.z]) {
          const e = matrix.elements;
          const p = { x: e[0] * x + e[4] * y + e[8] * z + e[12],
            y: e[1] * x + e[5] * y + e[9] * z + e[13],
            z: e[2] * x + e[6] * y + e[10] * z + e[14] };
          for (const axis of ['x', 'y', 'z']) {
            lo[axis] = Math.min(lo[axis], p[axis]);
            hi[axis] = Math.max(hi[axis], p[axis]);
          }
        }
      }
    }
    this.min = lo;
    this.max = hi;
    return this;
  }
}
const { prepareChunkBounds } = loadModule(readFileSync(join(__dirname, '../js/scene-culling.js'), 'utf8'), {
  imports: { 'three/webgpu': THREE },
  filename: 'scene-culling.js'
});
const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
function boxFrustum(box) {
  return {
    intersectsBox(other) {
      return ['x', 'y', 'z'].every((axis) => other.max[axis] >= box.min[axis] && other.min[axis] <= box.max[axis]);
    }
  };
}

test('static instanced bounds use actual instance extents and a frozen parent transform', () => {
  const mesh = {
    isInstancedMesh: true,
    matrixWorld: { elements: [0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 100, 7, -20, 1] },
    computeBoundingBox() {
      this.boundingBox = new Box3({ x: -10, y: 0, z: 5 }, { x: 30, y: 9, z: 6 });
    }
  };
  prepareChunkBounds(mesh);
  assert.deepEqual(mesh._cullingBox.min, { x: 120, y: 7, z: -80 });
  assert.deepEqual(mesh._cullingBox.max, { x: 124, y: 34, z: 0 });
  // The instance-local bounds must remain local for raycasts and other renderer consumers.
  assert.deepEqual(mesh.boundingBox.min, { x: -10, y: 0, z: 5 });
  const cached = mesh._cullingBox;
  mesh.intersectsFrustum(boxFrustum(cached));
  assert.equal(mesh._cullingBox, cached);
});

test('scene and cascade frusta are independent, including a cached far cascade', () => {
  const mesh = { matrixWorld: identity, geometry: {
    computeBoundingBox() { this.boundingBox = new Box3({ x: 50, y: 0, z: 0 }, { x: 60, y: 10, z: 10 }); }
  } };
  prepareChunkBounds(mesh);
  const scene = boxFrustum(new Box3({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 }));
  const cascade = boxFrustum(new Box3({ x: 40, y: -10, z: -10 }, { x: 70, y: 20, z: 20 }));
  assert.equal(mesh.intersectsFrustum(scene), false);
  assert.equal(mesh.intersectsFrustum(cascade), true);
  assert.equal(mesh.intersectsFrustum(scene), false);
  assert.equal(mesh.intersectsFrustum(cascade), true);
});

test('touching bounds and visible points are never rejected, including flat and outlier chunks', () => {
  for (const y of [0, 0.001, 300]) {
    const mesh = { matrixWorld: identity, geometry: {
      boundingBox: new Box3({ x: -1000, y: 0, z: -0.1 }, { x: 2, y, z: 0.1 })
    } };
    prepareChunkBounds(mesh);
    for (let i = 0; i <= 100; i++) {
      const x = -1000 + i * 10.02;
      const pointFrustum = boxFrustum(new Box3({ x: x - 0.001, y: 0, z: 0 }, { x: x + 0.001, y, z: 0 }));
      assert.equal(mesh.intersectsFrustum(pointFrustum), true);
    }
    assert.equal(mesh.intersectsFrustum(boxFrustum(new Box3(
      { x: 2, y, z: 0.1 }, { x: 3, y: y + 1, z: 1 }
    ))), true);
    assert.equal(mesh.intersectsFrustum(boxFrustum(new Box3(
      { x: 3, y: 0, z: 0 }, { x: 4, y: 1, z: 1 }
    ))), false);
  }
});

test('shader-displaced chunks keep the existing conservative renderer path', () => {
  for (const material of [{ positionNode: {} }, { vertexNode: {} }, { displacementMap: {} }, [{}, { castShadowPositionNode: {} }]]) {
    const original = () => true;
    const mesh = { material, intersectsFrustum: original };
    prepareChunkBounds(mesh);
    assert.equal(mesh.intersectsFrustum, original);
    assert.equal(mesh._cullingBox, undefined);
  }
});
