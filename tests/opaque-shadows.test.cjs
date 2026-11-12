const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Check the production selection and build-time branch. Shader equivalence still requires both browser backends.
const source = readFileSync(join(__dirname, '../js/tsl-materials.js'), 'utf8');
const start = source.indexOf('function prepareOpaqueShadows(');
const end = source.indexOf('\nexport {', start);
const prepare = vm.runInNewContext(`(${source.slice(start, end)})`, {
  THREE: { NormalBlending: 1 },
  Fn: callback => () => ({ build: callback }),
  vec4: (...values) => values
});
const material = (extra = {}) => ({
  isNodeMaterial: true, colorNode: { original: true }, opacity: 1, blending: 1, ...extra
});
const scene = objects => ({ traverse: visit => objects.forEach(visit) });

test('opaque casters preserve their scene graph and share a constant shadow colour', () => {
  const a = material();
  const b = material();
  const original = a.colorNode;
  const position = { wind: true };
  a.positionNode = position;
  prepare(scene([{ castShadow: true, material: a }, { castShadow: true, material: [a, b] }]));
  assert.equal(a.colorNode.build({ material: {} }), original);
  assert.deepEqual(a.colorNode.build({ material: { isShadowPassMaterial: true } }), [0, 0, 0, 1]);
  assert.deepEqual(b.colorNode.build({ material: { isShadowPassMaterial: true } }), [0, 0, 0, 1]);
  assert.equal(a.positionNode, position, 'vertex deformation remains on the original path');
});

for (const [key, value] of Object.entries({
  isNodeMaterial: false, colorNode: null, transparent: true, opacity: 0.5, alphaTest: 0.5,
  alphaTestNode: {}, alphaMap: {}, alphaHash: true, alphaToCoverage: true, blending: 2,
  transmission: 0.5, transmissionNode: {}, backdropNode: {}, maskNode: {}, maskShadowNode: {},
  castShadowNode: {}, opacityNode: {}
})) {
  test(`preserves the original shadow graph with ${key}`, () => {
    const mat = material({ [key]: value });
    const original = mat.colorNode;
    prepare(scene([{ castShadow: true, material: mat }]));
    assert.equal(mat.colorNode, original);
  });
}

test('ignores noncasters and objects without materials', () => {
  const mat = material();
  const original = mat.colorNode;
  prepare(scene([{ castShadow: false, material: mat }, { castShadow: true }]));
  assert.equal(mat.colorNode, original);
});
