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
