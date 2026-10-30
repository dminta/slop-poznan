const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/pedestrians.js'), 'utf8');
const POSE_STRIDE = 31 * 4;

// Geometry and shader construction run through inert nodes; the crowd's allocation, packing and upload paths
// stay real. In WebGL2 a read-only storage node needs PBO texture access instead of a per-vertex attribute.
function loadCrowd() {
  const inert = new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then' || key === Symbol.iterator) return undefined;
      return inert;
    },
    set: () => true,
    apply: () => inert,
    construct: () => inert
  });
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
    }
  }
  function attributeArray(count) {
    const value = {
      array: new Float32Array(count * 4),
      updateRanges: [],
      needsUpdate: false,
      clearUpdateRanges() { this.updateRanges.length = 0; },
      addUpdateRange(start, count) { this.updateRanges.push({ start, count }); }
    };
    return {
      value,
      isPBO: false,
      toReadOnly() { return this; },
      setPBO(enabled) { this.isPBO = enabled; return this; },
      element() { return inert; }
    };
  }
  const three = new Proxy({ Mesh }, { get: (target, key) => target[key] || inert });
  const tsl = new Proxy({ attributeArray }, { get: (target, key) => target[key] || inert });
  return loadModule(source, {
    imports: {
      'three/webgpu': three,
      'three/tsl': tsl,
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: inert }
    },
    filename: 'pedestrians.js'
  }).PersonCrowd;
}

function pose(value) {
  return { pose: new Float32Array(POSE_STRIDE).fill(value) };
}

test('both crowd LODs use PBO storage for random-access poses on WebGL2', () => {
  const PersonCrowd = loadCrowd();
  const crowd = new PersonCrowd(2);
  for (const lod of crowd.lods) {
    assert.equal(lod.pose.isPBO, true, `${lod.mesh.name} pose must use texture-backed storage`);
  }
  // WebGPU keeps a storage buffer and never creates the fallback texture.
  crowd.begin();
  crowd.add(pose(5));
  crowd.end();
  assert.equal(crowd.lods[0].pose.value.needsUpdate, true);
  assert.deepEqual([...crowd.lods[0].pose.value.array.slice(0, POSE_STRIDE)], [...pose(5).pose]);
});

test('crowd packs separate poses and uploads only occupied slots across both LODs', () => {
  const PersonCrowd = loadCrowd();
  const crowd = new PersonCrowd(2, { farDistance: 34 });
  // WebGL's setupPBO replaces this array with a texture-sized allocation after shader compilation.
  const padding = 16;
  for (const lod of crowd.lods) {
    const original = lod.pose.value.array;
    const padded = new Float32Array(original.length + padding).fill(99);
    padded.set(original);
    lod.pose.value.array = padded;
    lod.pose.value.pbo = { needsUpdate: false };
  }
  crowd.begin();
  crowd.add(pose(1), 0);
  crowd.add(pose(2), 34);
  crowd.add(pose(9), 0); // Capacity is independent for each LOD.
  crowd.add(pose(3), 35);
  crowd.end();

  const [near, far] = crowd.lods;
  assert.equal(near.mesh.count, 2);
  assert.equal(far.mesh.count, 1);
  assert.deepEqual([...near.pose.value.array.slice(0, 2 * POSE_STRIDE)], [...pose(1).pose, ...pose(2).pose]);
  assert.deepEqual([...far.pose.value.array.slice(0, POSE_STRIDE)], [...pose(3).pose]);
  assert.deepEqual(near.pose.value.updateRanges, [{ start: 0, count: 2 * POSE_STRIDE }]);
  assert.deepEqual(far.pose.value.updateRanges, [{ start: 0, count: POSE_STRIDE }]);
  for (const lod of crowd.lods) {
    assert.deepEqual([...lod.pose.value.array.slice(2 * POSE_STRIDE)], new Array(padding).fill(99));
  }
  assert.equal(near.pose.value.needsUpdate, true);
  assert.equal(far.pose.value.needsUpdate, true);
  assert.equal(near.pose.value.pbo.needsUpdate, true);
  assert.equal(far.pose.value.pbo.needsUpdate, true);
  near.pose.value.pbo.needsUpdate = false;
  far.pose.value.pbo.needsUpdate = false;

  crowd.begin();
  crowd.add(pose(4), 35);
  crowd.end();
  assert.equal(near.mesh.count, 0);
  assert.equal(near.pose.value.pbo.needsUpdate, false);
  assert.equal(far.pose.value.pbo.needsUpdate, true);
  assert.equal(far.mesh.count, 1);
  assert.deepEqual([...far.pose.value.array.slice(0, POSE_STRIDE)], [...pose(4).pose]);
  assert.deepEqual(far.pose.value.updateRanges, [{ start: 0, count: POSE_STRIDE }]);
});

test('crowd retains storage-buffer uploads before a WebGL PBO exists', () => {
  const PersonCrowd = loadCrowd();
  const crowd = new PersonCrowd(1);
  crowd.begin();
  crowd.add(pose(5), 0);
  crowd.end();
  assert.equal(crowd.lods[0].pose.value.pbo, undefined);
  assert.equal(crowd.lods[0].pose.value.needsUpdate, true);
  assert.deepEqual([...crowd.lods[0].pose.value.array], [...pose(5).pose]);
});
