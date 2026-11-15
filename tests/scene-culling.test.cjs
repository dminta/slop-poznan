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
class Frustum {}
const THREE = { Matrix4, Vector3, Frustum };
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

// Far blocks: the coarse copy and the 1 km chunks of one block are mutually exclusive and hold the same instances, so
// the swap only regroups draws. The camera's distance to the block's bounds decides it.
const { updateFarMerges, boxDistance, farMergeKey, FAR_CELL, FAR_MERGE_DIST, FAR_MERGE_WASTE } = loadModule(
  readFileSync(join(__dirname, '../js/scene-culling.js'), 'utf8'), {
    imports: { 'three/webgpu': THREE },
    filename: 'scene-culling.js'
  });

test('box distance is the Euclidean distance to the box and zero inside it', () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 20 } };
  assert.equal(boxDistance(box, 5, 2, 10), 0);
  assert.equal(boxDistance(box, 10, 5, 20), 0);
  assert.equal(boxDistance(box, 13, 2, 10), 3);
  assert.equal(boxDistance(box, 13, 9, 10), 5);
  assert.equal(boxDistance(box, -3, 9, 24), Math.sqrt(9 + 16 + 16));
});

test('coarse far cells nest the 1 km chunk cells, including negative coordinates', () => {
  assert.equal(FAR_CELL % 1000, 0);
  for (const x of [-12345.5, -4000, -3999.9, -1, 0, 999.9, 1000, 3999.9, 4000, 7777]) {
    for (const z of [-5000.1, -1, 0, 2500, 4000.5]) {
      const fineX = Math.floor(x / 1000);
      const fineZ = Math.floor(z / 1000);
      const k = FAR_CELL / 1000;
      assert.equal(farMergeKey(x, z), Math.floor(fineX / k) + ',' + Math.floor(fineZ / k));
    }
  }
});

function farBlock(fineBoxes, fineTriangles, coarseTriangles) {
  const fine = fineBoxes.map(() => ({ visible: true }));
  return {
    coarse: { visible: false },
    fine,
    box: { min: { x: 0, y: 0, z: 0 }, max: { x: 4000, y: 80, z: 4000 } },
    fineBoxes,
    fineTriangles,
    coarseTriangles,
    merged: false
  };
}
const visibleState = (block) => [block.coarse.visible, ...block.fine.map((c) => c.visible)].join();
const swapped = (block, merged) => visibleState(block) === [merged, ...block.fine.map(() => !merged)].join();

test('far blocks swap their fine chunks for the coarse copy past FAR_MERGE_DIST and back', () => {
  const block = farBlock([{}, {}, {}], [10, 10, 10], 30);
  updateFarMerges([block], 2000, 10, -(FAR_MERGE_DIST - 1));
  assert.equal(block.merged, false);
  assert.ok(swapped(block, false));
  updateFarMerges([block], 2000, 10, -FAR_MERGE_DIST);
  assert.equal(block.merged, true);
  assert.ok(swapped(block, true));
  updateFarMerges([block], 2000, 10, -(FAR_MERGE_DIST + 3000));
  assert.ok(swapped(block, true));
  updateFarMerges([block], 2000, 700, 2000); // above the block's footprint: the 3D distance decides
  assert.equal(block.merged, boxDistance(block.box, 2000, 700, 2000) >= FAR_MERGE_DIST);
  updateFarMerges([block], 1000, 40, 1000);
  assert.equal(block.merged, false);
  assert.ok(swapped(block, false));
});

test('far blocks stay fine-chunked when the view needs few chunks or the coarse copy would submit too much', () => {
  // Four fine chunks of 100 triangles, coarse copy 400 triangles; only the boxes the frustum accepts are in view
  const boxes = [0, 1, 2, 3].map((i) => ({ id: i }));
  const frustumSeeing = (...ids) => ({ intersectsBox: (box) => ids.includes(box.id) });
  const camera = [2000, 10, -2000];
  const run = (frustum, tris = [100, 100, 100, 100]) => {
    const block = farBlock(boxes, tris, 400);
    updateFarMerges([block], ...camera, frustum);
    return block;
  };
  assert.equal(run(frustumSeeing(0, 1, 2, 3)).merged, true);
  assert.equal(run(frustumSeeing(0, 1)).merged, true); // 200 x FAR_MERGE_WASTE(2) reaches the coarse 400
  assert.equal(FAR_MERGE_WASTE, 2);
  assert.equal(run(frustumSeeing(0, 1), [90, 90, 100, 100]).merged, false); // coarse would draw > 2x what is in view
  assert.equal(run(frustumSeeing(2)).merged, false); // a single chunk in view: the coarse copy only adds triangles
  assert.equal(run(frustumSeeing()).merged, false);
  // Once merged, a view that no longer needs the coarse copy hands back the fine chunks
  const block = farBlock(boxes, [100, 100, 100, 100], 400);
  updateFarMerges([block], ...camera, frustumSeeing(0, 1, 2, 3));
  assert.ok(swapped(block, true));
  updateFarMerges([block], ...camera, frustumSeeing(3));
  assert.ok(swapped(block, false));
});
