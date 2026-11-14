const test = require('node:test');
const assert = require('node:assert/strict');

test('removed tram surfaces return roadway ground for ordinary, park and underpass blocks', async () => {
  const config = await import('../js/city-config.js');
  const { blockAt, isBlockAt, BLOCKS, UNDERPASS_SIDEWALKS, tramSurfaceClearance } = config;
  const { loadModule } = require('./helpers/module.cjs');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { inert } = await import('../tools/audit-tram-bed-surfaces.mjs');
  const stub = inert();
  const { ThirdPersonControllerManager } = loadModule(readFileSync(join(__dirname, '../js/controllers.js'), 'utf8'), {
    imports: { 'three/webgpu': stub, 'three/tsl': stub, './city-config.js': config,
      './tsl-materials.js': stub, './actor-models.js': stub, './pedestrians.js': stub, './vehicle-lights.js': stub }
  });
  const controller = Object.create(ThirdPersonControllerManager.prototype);
  for (const [x, z] of [[-1036.93, -798.19], [-1021.85, -811.02], [-1037.08, -803.41],
    [483.43, -1927.80], [2551.87, 2645.09]]) {
    assert.equal(blockAt(x, z)?.id ?? null, null, `removed surface at ${x}, ${z} must be roadway ground`);
    for (const mode of ['person', 'car', 'cyclist']) assert.equal(controller.getGroundHeight(x, z, mode), 0);
    assert.equal(tramSurfaceClearance(x, z), 0);
    assert.equal(isBlockAt(x, z, null), true);
    for (const b of [...BLOCKS, ...UNDERPASS_SIDEWALKS]) assert.equal(isBlockAt(x, z, b), false);
  }
});

test('all tram corridors agree between rendered surfaces and blockAt', async () => {
  const { audit } = await import('../tools/audit-tram-bed-surfaces.mjs');
  const { resolve } = require('node:path');
  const result = await audit(resolve(__dirname, '..'), false, true);
  assert.ok(result.heightAgreement.samples > 100000);
  assert.equal(result.summary.overlaps, 0);
  assert.equal(result.heightAgreement.logicalRaised, 0);
  assert.equal(result.heightAgreement.renderedRaised, 0);
  assert.equal(result.heightAgreement.mismatches, 0);
  assert.ok(result.heightAgreement.predicateChecks > result.heightAgreement.samples);
  assert.equal(result.heightAgreement.predicateMismatches, 0);
});
