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
const { createRoofs, createRoofGeometries, createDormerGeometries, planDormers, slopeHeight, DORMER_ROOF } = loadModule(readFileSync(join(__dirname, '../js/roofs.js'), 'utf8'), {
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

// Seeded generator for the dormer tests (the same mulberry32 buildings.js uses)
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('dormer pieces are low-poly with outward normals', () => {
  const { dormer, window: pane } = createDormerGeometries();
  assert.equal(triangles(dormer).length, 11);
  assert.equal(triangles(pane).length, 2);
  for (const { v, n } of triangles(dormer)) {
    const g = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const len = Math.hypot(...g);
    for (let a = 0; a < 3; a++) close(g[a] / len, n[a]);
    const c = [0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3);
    // away from the inside of the dormer (x 0, z -0.5): front faces +z, cheeks ±x, the roof up
    assert.ok(n[0] * c[0] + n[2] * (c[2] + 0.5) + n[1] * Math.max(0, c[1] - 1) > 0, 'faces out');
    for (const p of v) assert.ok(p[1] >= 0 && p[1] <= 1 + DORMER_ROOF + 1e-6 && p[2] <= 1e-6 && p[2] >= -1 - 1e-6);
  }
  for (const { n } of triangles(pane)) close(n[2], 1);
});

test('dormer rows are deterministic, fit under the ridge and inside the ridge length, and skip short roofs', () => {
  const a = planDormers('gable', 16, 13.6, 5, mulberry32(42));
  const b = planDormers('gable', 16, 13.6, 5, mulberry32(42));
  assert.deepEqual({ ...a, us: a.us.slice() }, { ...b, us: b.us.slice() });
  for (const [shape, w, d, h] of [['gable', 16, 13.6, 5], ['gable', 20, 14, 4], ['mansard', 18, 14, 3.4], ['gambrel', 14, 12, 3.4], ['hip', 22, 13, 4.4]]) {
    for (let seed = 1; seed <= 40; seed++) {
      const p = planDormers(shape, w, d, h, mulberry32(seed));
      if (!p) continue;
      const hd = d / 2;
      close(p.base, slopeHeight(shape, hd, h, p.s0)); // the front wall stands on the slope
      const top = p.base + p.dh * (1 + DORMER_ROOF);
      assert.ok(top <= h - 0.35 + 1e-9, `${shape}: under the ridge`);
      // its ridge meets the slope at the back (buried 0.15 m), no deeper than 3.6 m
      assert.ok(slopeHeight(shape, hd, h, p.s0 + p.depth - 0.15) >= top - 1e-6);
      assert.ok(p.depth <= 3.6 + 1e-6 && p.depth > 0.5);
      assert.ok(p.us.length >= 1 && p.us.length <= 3);
      const reach = Math.max(...p.us.map(Math.abs)) + p.dw / 2;
      assert.ok(reach <= w / 2 - (shape === 'hip' || shape === 'mansard' ? p.s0 + p.depth - 0.15 : 1) + 1e-6, `${shape}: inside the ridge length`);
      if (shape === 'mansard' || shape === 'gambrel') assert.ok(top <= 0.72 * h + 0.2 + 1e-9, 'inside the steep band');
    }
  }
  assert.equal(planDormers('gable', 16, 13, 1.8, mulberry32(1)), null, 'too low a rise');
  assert.equal(planDormers('gable', 4, 13, 5, mulberry32(1)), null, 'too short a ridge');
  assert.equal(planDormers('gable', 16, 5, 5, mulberry32(1)), null, 'too shallow a slope');
});

test('addDormers stands each dormer on its slope, facing down it, with its window on the front', () => {
  const roofs = createRoofs();
  assert.equal(roofs.addDormers('gable', 'copper', 0, 10, 0, 16, 13.6, 5, 0, { rand: mulberry32(3) }), 0, 'no copper dormers');
  // only the slope facing world +x (a ridge along z: ry = π/2) is wanted
  const added = roofs.addDormers('gable', 'tile', 100, 10, 50, 16, 13.6, 5, Math.PI / 2, { rand: mulberry32(3), facing: (dx) => (dx > 0.5 ? 1 : 0) });
  assert.ok(added >= 1);
  roofs.finish();
  const byName = Object.fromEntries(roofs.meshes.map((m) => [m.name, m]));
  const body = byName['Roof-dormer-tile'];
  const pane = byName['Roof-dormerWindow'];
  assert.equal(body.count, added);
  assert.equal(pane.count, added);
  for (let k = 0; k < added; k++) {
    const e = body.instanceMatrix.array.subarray(k * 16, k * 16 + 16);
    // the front wall faces +x (local +z → world +x) and stands 6.8 - 0.8 m out from the ridge line x = 100
    close(e[8] / Math.hypot(e[8], e[10]), 1);
    close(e[12], 106);
    close(e[13], 10 + slopeHeight('gable', 6.8, 5, 0.8));
    assert.ok(Math.abs(e[14] - 50) <= 8 - 1);
    const w = pane.instanceMatrix.array.subarray(k * 16, k * 16 + 16);
    assert.ok(w[12] > e[12] && w[12] - e[12] < 0.1, 'the pane sits just proud of the front wall');
    close(w[14], e[14]);
  }
});
