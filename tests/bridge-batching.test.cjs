const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const inert = new Proxy(() => inert, { get: () => inert });
const { batchBridgeSections } = loadModule(readFileSync(join(__dirname, '../js/bridges.js'), 'utf8'), {
  imports: {
    'three/webgpu': THREE,
    'three/tsl': inert,
    './tsl-materials.js': inert,
    './city-config.js': { CITY_BOUNDS: { waterLevel: -3 } },
    './geodata.js': {},
    'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: (geos) => ({ parts: geos }) }
  },
  filename: 'bridges.js'
});

function section(group, name, geometry, material, values, cast = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, values.length);
  mesh.name = name;
  mesh.castShadow = cast;
  mesh.receiveShadow = false;
  values.forEach((v, i) => mesh.instanceMatrix.array.fill(v, i * 16, (i + 1) * 16));
  group.add(mesh);
  return mesh;
}

test('bridge section batching preserves every packed matrix, material, bridge and shadow flag', () => {
  const group = new THREE.Group();
  const box = { uuid: 'box' }, panel = { uuid: 'panel' };
  const steel = { uuid: 'steel' }, concrete = { uuid: 'concrete' }, glass = { uuid: 'glass', transparent: true };
  const first = section(group, 'Most', box, steel, [1, 2]);
  const second = section(group, 'Most', box, steel, [3]);
  const expected = [...first.instanceMatrix.array, ...second.instanceMatrix.array];
  const retained = [
    section(group, 'Other', box, steel, [4]),
    section(group, 'Most', panel, steel, [5]),
    section(group, 'Most', box, concrete, [6]),
    section(group, 'Most', box, steel, [7], false),
    section(group, 'Most', box, glass, [8]),
    section(group, 'Most', box, glass, [9])
  ];
  const receiving = section(group, 'Most', box, steel, [10]);
  receiving.receiveShadow = true;
  retained.push(receiving);
  batchBridgeSections(group);
  assert.equal(group.children.length, 8);
  for (const mesh of retained) assert.ok(group.children.includes(mesh));
  const merged = group.children.find((m) => !retained.includes(m));
  assert.equal(merged.count, 3);
  assert.equal(merged.geometry, box);
  assert.equal(merged.material, steel);
  assert.equal(merged.name, 'Most');
  assert.equal(merged.castShadow, true);
  assert.equal(merged.receiveShadow, false);
  assert.deepEqual([...merged.instanceMatrix.array], expected);
  batchBridgeSections(group);
  assert.equal(group.children.length, 8);
});

test('shaped bridge sections merge only within the same bridge and shadow flags', () => {
  const group = new THREE.Group();
  const mat = { uuid: 'deck' };
  const pieces = [];
  for (const [name, cast] of [['Most', true], ['Most', true], ['Most', false], ['Other', true]]) {
    const mesh = new THREE.Mesh({ part: pieces.length }, mat);
    Object.assign(mesh, { name, castShadow: cast, receiveShadow: false });
    pieces.push(mesh); group.add(mesh);
  }
  batchBridgeSections(group);
  assert.equal(group.children.length, 3);
  const merged = group.children.find((m) => !pieces.includes(m));
  assert.deepEqual([...merged.geometry.parts], [pieces[0].geometry, pieces[1].geometry]);
  assert.equal(merged.material, mat);
  assert.equal(merged.castShadow, true);
});
