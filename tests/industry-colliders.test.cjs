const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const root = join(__dirname, '..');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

test('controllers.js resolves circular colliders smoothly from all 8 directions for person and car', async () => {
  const config = await import('../js/city-config.js');
  const { ThirdPersonControllerManager } = loadModule(readFileSync(join(root, 'js/controllers.js'), 'utf8'), {
    globals: { window: { addEventListener() {} }, document: { addEventListener() {}, hidden: false } },
    imports: {
      'three/webgpu': inert(),
      'three/tsl': inert(),
      './city-config.js': config,
      './tsl-materials.js': inert(),
      './actor-models.js': inert(),
      './pedestrians.js': inert(),
      './vehicle-lights.js': inert()
    },
    filename: 'controllers.js'
  });

  const cx = 100, cz = -200, r = 10;
  const col = { minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, minY: 0, maxY: 50, circle: { cx, cz, r } };

  for (const mode of ['person', 'car']) {
    const dists = [];
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4;
      const mgr = Object.create(ThirdPersonControllerManager.prototype);
      mgr.colliders = [col];
      mgr._colliderCells = null;
      mgr.keepOut = null;
      mgr.activeMode = mode;
      mgr.keys = { forward: 1, backward: 0, left: 0, right: 0, up: 0, down: 0, boost: false };
      mgr.getGroundHeight = () => 0;
      mgr.updateCarLights = () => {};
      mgr.entities = {
        person: { type: 'person', position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, verticalVel: 0 },
        car: {
          type: 'car', position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0,
          steerAngle: 0, angularVel: 0, pitchVel: 0, rollVel: 0, heaveVel: 0, heaveY: 0, wheelSpin: 0, wheels: [],
          chassisPivot: { rotation: { x: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } }
        }
      };
      const ent = mgr.entities[mode];
      ent.position.x = cx + Math.sin(angle) * (r + 6);
      ent.position.z = cz + Math.cos(angle) * (r + 6);
      ent.heading = angle + Math.PI;
      for (let i = 0; i < 120; i++) {
        if (mode === 'person') mgr.updatePerson(0.05);
        else mgr.updateCar(0.05);
      }
      const d = Math.hypot(ent.position.x - cx, ent.position.z - cz);
      dists.push(d);
    }
    const spread = Math.max(...dists) - Math.min(...dists);
    assert.ok(spread < 0.01, `${mode} stop distance should be radially uniform, got spread=${spread}`);
    const expected = mode === 'person' ? r + 0.48 : r + 2.23;
    assert.ok(Math.abs(dists[0] - expected) < 0.06, `${mode} stop distance ${dists[0]} near ${expected}`);
  }
});

test('all industrial structures in the detail box have circular colliders within 0.1 m of rendered 0-2 m silhouettes', () => {
  const raw = execFileSync(process.execPath, [join(root, 'tools/audit-industry-colliders.mjs'), '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const report = JSON.parse(raw);
  assert.equal(report.instancedCounts.cooling.structures, 1);
  assert.equal(report.instancedCounts.cooling.instanced, 1);
  assert.equal(report.instancedCounts.chimneys.structures, 6);
  assert.equal(report.instancedCounts.chimneys.instanced, 6);

  const ecCooling = report.structures.find((s) => s.site === 'EC Garbary' && s.kind === 'cooling');
  const ecChimney = report.structures.find((s) => s.site === 'EC Garbary' && s.kind === 'chimney');
  const wartaChimney = report.structures.find((s) => s.kind === 'chimney' && Math.hypot(s.x - 604, s.z - 218) < 5);
  assert.ok(ecCooling, 'EC Garbary 55 m cooling tower present');
  assert.ok(ecChimney, 'EC Garbary 65 m chimney present');
  assert.ok(wartaChimney, 'OSM 45 m chimney by the Warta present');

  for (const s of report.structures) {
    assert.equal(s.nonCircleCount, 0, `${s.site} ${s.kind} uses circular collider`);
    assert.equal(s.aabbMismatches, 0, `${s.site} ${s.kind} AABB matches circle`);
    assert.ok(s.maxGap <= 0.1, `${s.site} ${s.kind} maxGap=${s.maxGap} <= 0.1 m`);
    assert.ok(s.maxPenetration <= 0.1, `${s.site} ${s.kind} maxPenetration=${s.maxPenetration} <= 0.1 m`);
    assert.equal(s.overlaps.buildingOverlaps, 0, `${s.site} ${s.kind} clear of buildings`);
    assert.equal(s.overlaps.roadOverlap, 0, `${s.site} ${s.kind} clear of roads`);
    assert.equal(s.overlaps.railOverlap, 0, `${s.site} ${s.kind} clear of rails`);
    assert.equal(s.overlaps.propOverlaps, 0, `${s.site} ${s.kind} clear of props`);
    for (const p of s.personSim) {
      assert.equal(p.passedThrough, false, `${s.site} person ${p.dir} did not pass through`);
      assert.ok(p.gapFromBody <= 0.1, `${s.site} person ${p.dir} gap=${p.gapFromBody} <= 0.1 m`);
    }
    for (const c of s.carSim) {
      assert.equal(c.passedThrough, false, `${s.site} car ${c.dir} did not pass through`);
      assert.ok(c.gapFromBody <= 0.15, `${s.site} car ${c.dir} gap=${c.gapFromBody} <= 0.15 m`);
    }
  }
});
