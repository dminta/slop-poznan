const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class Float32BufferAttribute {
  constructor(array, itemSize) {
    this.array = Float32Array.from(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
  }
}
class InstancedBufferAttribute extends Float32BufferAttribute {}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
}
class InstancedMesh {
  constructor(geometry, material, count) {
    Object.assign(this, { geometry, material, count, visible: true });
    this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16);
  }
  computeBoundingBox() { this.boxed = true; }
  computeBoundingSphere() { this.sphered = true; }
}
class MeshStandardNodeMaterial {
  constructor(params) { Object.assign(this, params); }
}
const THREE = { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial };
const { createRoofs, createRoofGeometries } = loadModule(readFileSync(join(__dirname, '../js/roofs.js'), 'utf8'), {
  imports: { 'three/webgpu': THREE },
  globals: { Math, Float32Array, Int32Array }
});

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} should equal ${b}`);
const triangles = (geo) => {
  const p = geo.attributes.position.array;
  const nm = geo.attributes.normal.array;
  const out = [];
  for (let i = 0; i < p.length; i += 9) {
    out.push({ v: [[p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]]], n: [nm[i], nm[i + 1], nm[i + 2]] });
  }
  return out;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// world-space triangles of one mesh's instances (instance matrix applied to positions)
const worldTris = (mesh) => {
  const out = [];
  const m = mesh.instanceMatrix.array;
  for (let k = 0; k < mesh.count; k++) {
    const e = m.subarray(k * 16, k * 16 + 16);
    const xf = ([x, y, z]) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
    for (const t of triangles(mesh.geometry)) out.push(t.v.map(xf));
  }
  return out;
};

test('unit roof pieces are low-poly and their stored normals face out along their winding', () => {
  const geos = createRoofGeometries();
  const expected = { prism: 6, hipCap: 3, gambrel: 14, mansardCap: 9 };
  for (const [name, geo] of Object.entries(geos)) {
    const tris = triangles(geo);
    assert.equal(tris.length, expected[name], name);
    assert.equal(geo.attributes.uv.count, tris.length * 3);
    for (const { v, n } of tris) {
      const g = cross(sub(v[1], v[0]), sub(v[2], v[0]));
      const len = Math.hypot(...g);
      for (let a = 0; a < 3; a++) close(g[a] / len, n[a]);
      assert.ok(n[1] > -1e-9, `${name}: no face points down`);
      for (const p of v) assert.ok(p[1] >= 0 && p[1] <= 1 && Math.abs(p[2]) <= 0.5, `${name}: inside the unit box`);
    }
  }
});

test('a hip roof keeps one pitch on all four slopes and stays on its turned plan', () => {
  const roofs = createRoofs();
  const ry = 0.4;
  assert.equal(roofs.add('hip', 'tile', 10, 20, -5, 8, 24, 3, ry), true); // d > w: the ridge turns onto the long side
  roofs.finish();
  const tris = roofs.meshes.flatMap((mesh) => (mesh.count ? worldTris(mesh) : []));
  assert.equal(tris.length, 6 + 3 + 3);
  const c = Math.cos(ry), s = Math.sin(ry);
  let top = 0;
  for (const v of tris) {
    for (const [x, y, z] of v) {
      // back into the roof's own frame: w (8) along local x, d (24) along local z
      const lx = (x - 10) * c - (z + 5) * s;
      const lz = (x - 10) * s + (z + 5) * c;
      assert.ok(Math.abs(lx) <= 4 + 1e-6 && Math.abs(lz) <= 12 + 1e-6, 'within the plan');
      assert.ok(y >= 20 - 1e-6 && y <= 23 + 1e-6);
      top = Math.max(top, y);
    }
    const g = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const len = Math.hypot(...g);
    if (len < 1e-9 || Math.abs(g[1] / len) > 0.999) continue;
    if (Math.abs(g[1] / len) < 1e-6) continue; // the hidden gable triangles inside the caps
    close(g[1] / len, 4 / Math.hypot(4, 3), 1e-5); // rise 3 over a run of half the depth (4 m)
  }
  close(top, 23);
});

test('turned frames move their roofs, and the pool and finish keep exact counts', () => {
  const roofs = createRoofs({ max: 4 });
  const from = roofs.mark();
  assert.equal(roofs.add('gable', 'slate', 1, 0, 0, 10, 6, 2), true);
  roofs.transform(from, (x, z) => [x + 100, z + 50], Math.PI * 0.5);
  assert.equal(roofs.add('mansard', 'copper', 0, 0, 0, 12, 10, 3), true);
  assert.equal(roofs.add('hip', 'tile', 0, 0, 0, 12, 10, 3), false, 'a hip needs 3 instances; only 0 left');
  assert.equal(roofs.add('dome', 'tile', 0, 0, 0, 12, 10, 3), false);
  assert.equal(roofs.count(), 4);
  roofs.finish();
  assert.equal(roofs.add('gable', 'tile', 0, 0, 0, 1, 1, 1), false, 'finished');
  const byName = Object.fromEntries(roofs.meshes.map((m) => [m.name, m]));
  const gable = byName['Roof-prism-slate'];
  assert.equal(gable.count, 1);
  assert.equal(gable.instanceMatrix.count, 1);
  const e = gable.instanceMatrix.array;
  close(e[12], 101);
  close(e[14], 50);
  close(e[2], -10); // local x (the ridge, w = 10) now runs along −z after a quarter turn
  assert.equal(byName['Roof-gambrel-copper'].count, 1);
  assert.equal(byName['Roof-mansardCap-copper'].count, 2);
  for (const m of roofs.meshes) {
    assert.equal(m.instanceMatrix.count, Math.max(1, m.count));
    assert.equal(m.visible, m.count > 0);
  }
});
