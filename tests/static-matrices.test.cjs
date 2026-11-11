const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/static-matrices.js'), 'utf8');
const { collectDynamicRoots, freezeStaticMatrices, updateDynamicMatrices } = loadModule(source);

function worldObject(name) {
  return {
    name,
    matrixWorldAutoUpdate: true,
    updates: [],
    updateMatrixWorld(force) {
      this.updates.push(force);
    }
  };
}

test('the dynamic roots cover every mover and skip the static city', () => {
  const names = ['LandmarksDynamic', 'StoreClusteredLights', 'StreetClusteredLights', 'TrafficAndPedestrians', 'Trams'];
  const groups = Object.fromEntries(names.map((name) => [name, worldObject(name)]));
  const scene = { getObjectByName: (name) => groups[name] || null };
  const sky = worldObject('sky');
  const sunLight = worldObject('sunLight');
  const hemiLight = worldObject('hemiLight');
  const personShadow = worldObject('player person crowd 0');
  const personFar = worldObject('player person crowd 1');
  const helmet = worldObject('cyclist helmet');
  const riderNear = worldObject('cyclist rider crowd 0');
  const riderFar = worldObject('cyclist rider crowd 1');
  const entities = {
    person: { mesh: worldObject('PlayerPerson'), crowd: { meshes: [personShadow, personFar] } },
    car: { mesh: worldObject('PlayerTaxiCar') },
    cyclist: { mesh: worldObject('PlayerCyclist'), helmet, riderCrowd: { meshes: [riderNear, riderFar] } },
    helicopter: { mesh: worldObject('PlayerHelicopter') }
  };
  const roots = collectDynamicRoots(scene, { sky, sunLight, hemiLight }, { entities });

  const movers = [
    ...Object.values(groups), sky, sunLight, hemiLight, helmet, personShadow, personFar, riderNear, riderFar
  ];
  for (const object of movers) assert.ok(roots.includes(object), `${object.name} is updated every frame`);
  for (const entity of Object.values(entities)) {
    assert.ok(roots.includes(entity.mesh), `${entity.mesh.name} is updated`);
  }
  assert.ok(!roots.includes(scene), 'the frozen scene root is not in the per-frame list');
  assert.equal(new Set(roots).size, roots.length, 'no root is updated twice');
});

test('missing named roots are skipped instead of leaving holes', () => {
  const scene = { getObjectByName: () => null };
  const vector = { mesh: worldObject('mesh'), crowd: { meshes: [] } };
  const roots = collectDynamicRoots(scene, { sky: null }, {
    entities: { person: vector, cyclist: { mesh: worldObject('bike'), helmet: null, riderCrowd: { meshes: [] } } }
  });
  assert.deepEqual([...roots].map((root) => root.name), ['mesh', 'bike']);
});

test('freezing records all world matrices once and stops automatic updates', () => {
  const scene = worldObject('scene');
  const roots = [worldObject('a'), worldObject('b')];
  assert.equal(freezeStaticMatrices(scene, roots), roots);
  assert.deepEqual(scene.updates, [true], 'the whole static graph is computed once');
  assert.equal(scene.matrixWorldAutoUpdate, false, 'the renderer no longer traverses the scene every pass');

  updateDynamicMatrices(roots);
  assert.deepEqual(roots[0].updates, [true], 'each dynamic root is forced once per frame');
  assert.deepEqual(roots[1].updates, [true]);
  assert.deepEqual(scene.updates, [true], 'the static graph is never walked again');
});
