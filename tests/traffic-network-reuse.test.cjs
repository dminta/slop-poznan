const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('traffic reuses an injected road network and builds one only when omitted', () => {
  const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
  const start = source.indexOf('function createTrafficSystem(');
  const end = source.indexOf('  // Sides of an intersection', start);
  assert.ok(start >= 0 && end > start);
  let calls = 0;
  const built = { nodes: [], edges: [] };
  const args = [];
  class Object3D { rotateX() {} makeScale() { return this; } }
  const create = vm.runInNewContext(`(${source.slice(start, end)} return network; })`, {
    THREE: { Group: Object3D, Object3D, Matrix4: Object3D, PlaneGeometry: Object3D },
    createContactShadowMaterial: () => ({}),
    buildRoadNetwork: (...values) => { calls++; args.push(...values); return built; }
  });
  const supplied = { nodes: [], edges: [] }, sidewalks = [], obstacles = [];
  assert.equal(create({}, sidewalks, obstacles, supplied), supplied);
  assert.equal(calls, 0);
  assert.equal(create({}, sidewalks, obstacles), built);
  assert.equal(calls, 1);
  assert.deepEqual(args, [sidewalks, obstacles]);
});
