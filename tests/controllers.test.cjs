const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function keyboardHarness(nyc = {}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const config = {
    SPAWN: { x: 0, z: 0, heading: 0 },
    isTypingInField: (event) => ['INPUT', 'SELECT'].includes(event.target?.tagName),
    RAISED_GROUND: [],
    ...nyc
  };
  const { ThirdPersonControllerManager } = loadModule(source, {
    globals: { window, document },
    imports: {
      'three/webgpu': {},
      './city-config.js': config,
      './tsl-materials.js': {},
      './actor-models.js': {},
      './pedestrians.js': {},
      './vehicle-lights.js': {}
    }
  });
  // Exercise the production event handlers without constructing the scene's 3D models.
  const controller = Object.create(ThirdPersonControllerManager.prototype);
  controller.keys = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'down', 'boost'].map((action) => [action, false]));
  controller.bindKeyboard();
  return {
    controller,
    window,
    document,
    key(type, code, tagName = 'BODY') {
      window.dispatch(type, { code, target: { tagName } });
    }
  };
}

test('releasing a movement key after focusing search stops movement', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false);

  key('keydown', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false, 'typing in search does not move the player');
});

test('releasing one movement binding preserves another held binding', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  key('keydown', 'ArrowUp');
  key('keyup', 'ArrowUp');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('either Shift key keeps boost active until both are released', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'ShiftLeft');
  key('keydown', 'ShiftRight');
  key('keyup', 'ShiftLeft');
  assert.equal(controller.keys.boost, true);
  key('keyup', 'ShiftRight');
  assert.equal(controller.keys.boost, false);
});

test('keyboard and touch input remain active independently', () => {
  const { controller, key } = keyboardHarness();
  controller.setTouchInput('forward', 0.35);
  assert.equal(controller.keys.forward, 0.35);
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  controller.setTouchInput('forward', 0.6);
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, 0.6);
  controller.setTouchInput('forward', 0);
  assert.equal(controller.keys.forward, false);
});

test('clearing touch input preserves held keyboard controls', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  controller.setTouchInput('forward', 0.4);
  controller.setTouchInput('left', 0.7);
  controller.setTouchInput('boost', true);
  controller.clearTouchInput();
  assert.equal(controller.keys.forward, true);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.boost, false);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('touch strengths are clamped and unknown actions are ignored', () => {
  const { controller } = keyboardHarness();
  controller.setTouchInput('forward', 2);
  controller.setTouchInput('left', -0.5);
  controller.setTouchInput('up', true);
  controller.setTouchInput('unknown', 1);
  assert.equal(controller.keys.forward, 1);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.up, true);
  assert.equal(Object.hasOwn(controller.keys, 'unknown'), false);
});

for (const interruption of ['blur', 'hidden', 'reset']) {
  test(`${interruption} clears held controls and their physical key state`, () => {
    const { controller, window, document, key } = keyboardHarness();
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    controller.setTouchInput('forward', 0.4);
    controller.setTouchInput('backward', 0.8);
    controller.setTouchInput('down', true);
    if (interruption === 'blur') {
      window.dispatch('blur');
    } else if (interruption === 'hidden') {
      document.hidden = true;
      document.dispatch('visibilitychange');
    } else {
      controller.resetInput();
    }
    assert.equal(Object.values(controller.keys).some(Boolean), false);

    // A fresh use of the alias must not revive the old key whose keyup was lost.
    key('keydown', 'ArrowUp');
    key('keyup', 'ArrowUp');
    assert.equal(controller.keys.forward, false);
  });
}

function advanceWithTouch(mode, strength, reverse) {
  const { controller } = keyboardHarness();
  const entity = { position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0 };
  if (mode === 'Person') Object.assign(entity, { verticalVel: 0 });
  if (mode === 'Car') Object.assign(entity, {
    vx: 0, vz: 0, angularVel: 0, steerAngle: 0, pitchVel: 0, rollVel: 0, heaveVel: 0, heaveY: 0, wheelSpin: 0,
    chassisPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }, wheels: []
  });
  if (mode === 'Cyclist') Object.assign(entity, {
    leanAngle: 0, leanPivot: { rotation: { z: 0 } },
    frontWheel: { rotation: { x: 0 } }, rearWheel: { rotation: { x: 0 } },
    pedalPhase: 0, crankPivot: { rotation: { x: 0 } }, pedals: []
  });
  if (mode === 'Helicopter') Object.assign(entity, {
    verticalSpeed: 0, pitchAngle: 0, rollAngle: 0,
    tiltPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
  });
  controller.entities = { [mode.toLowerCase()]: entity };
  controller.getGroundHeight = () => 0;
  controller.resolveHorizontalCollision = () => {};
  controller.setTouchInput(reverse ? 'backward' : 'forward', strength);
  controller.setTouchInput(reverse ? 'right' : 'left', strength);
  if (mode === 'Helicopter') controller.setTouchInput(reverse ? 'down' : 'up', strength);
  controller[`update${mode}`](0.1, 0);
  return entity;
}

for (const mode of ['Person', 'Car', 'Cyclist', 'Helicopter']) {
  test(`analog ${mode.toLowerCase()} input proportionally scales movement and turning`, () => {
    for (const reverse of [false, true]) {
      const full = advanceWithTouch(mode, 1, reverse);
      const partial = advanceWithTouch(mode, 0.4, reverse);
      assert.ok(Math.abs(partial.speed - full.speed * 0.4) < 1e-10, 'movement should scale with joystick strength');
      const turn = mode === 'Car' ? 'steerAngle' : 'heading';
      assert.ok(Math.abs(partial[turn] - full[turn] * 0.4) < 1e-10, 'turning should scale with joystick strength');
      if (mode === 'Helicopter') {
        assert.ok(Math.abs(partial.verticalSpeed - full.verticalSpeed * 0.4) < 1e-10);
      }
    }
  });
}

function teleportHarness(mode, colliders = [], shore = () => ({ westX: -500, eastX: 500 })) {
  const harness = keyboardHarness({
    CITY_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
    RAISED_GROUND: [{ minX: 1000, maxX: 1100, minZ: 1000, maxZ: 1100, top: 1.24 }],
    // Same semantics as city-config.js clampToLand, answered from the test's shore profile
    clampToLand: (x, z, margin = 0) => {
      const { westX, eastX } = shore(z);
      if (westX + margin > eastX - margin) return { x: (westX + eastX) * 0.5, z };
      return { x: Math.max(westX + margin, Math.min(eastX - margin, x)), z };
    },
    isLand: (x, z, margin = 0) => {
      const { westX, eastX } = shore(z);
      return x >= westX + margin && x <= eastX - margin;
    },
    blockAt: () => null
  });
  const { controller } = harness;
  const position = (x = 0, y = 0, z = 0) => ({ x, y, z, copy(p) { this.x = p.x; this.y = p.y; this.z = p.z; } });
  const pivot = () => ({ position: position(), rotation: { x: 0.1, y: 0, z: -0.2 } });
  const chase = { person: [4.3, 1.95], car: [6.9, 2.12], cyclist: [4.8, 2.05], helicopter: [11.4, 3.3] };
  const ent = {
    type: mode, chaseDistance: chase[mode][0], chaseHeight: chase[mode][1],
    position: position(400, mode === 'helicopter' ? 120 : 0, 400), heading: 1, speed: 20,
    mesh: pivot(),
    verticalVel: 5, vx: 3, vz: -4, angularVel: 2, steerAngle: 0.4,
    pitchVel: 3, rollVel: 4, heaveY: 0.1, heaveVel: 2, chassisPivot: pivot(),
    lastCollisionSpark: { speed: 5 }, carState: { value: { x: 0 } }, wheelSpin: 1,
    wheels: [{ isFront: true, steerPivot: { rotation: { y: 0.4 } }, tire: { rotation: { x: 0 } } }],
    leanAngle: 0.3, leanPivot: pivot(), pedalPhase: 0.7,
    frontWheel: { rotation: { x: 0 } }, rearWheel: { rotation: { x: 0 } },
    crankPivot: { rotation: { x: 0 } }, pedals: [],
    verticalSpeed: -8, pitchAngle: 0.2, rollAngle: -0.2, tiltPivot: pivot(),
    rig: { reset(...args) { this.resetArgs = args; } },
    crowd: { begin() {}, add() {}, end() {} }
  };
  controller.activeMode = mode;
  controller.entities = { [mode]: ent };
  controller.colliders = colliders;
  controller._colliderCells = null;
  controller.getGroundHeight = (x, z, mode) => mode === 'person' ? (x < 0 ? 1.24 : 0.22) : 0;
  return { ...harness, ent };
}

for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
  test(`${mode} teleport stops carried motion and updates its arrival pose immediately`, () => {
    const { controller, ent, key } = teleportHarness(mode);
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    controller.setTouchInput('left', 0.8);
    const result = controller.teleportActiveTo(30, 20, 0.7);
    assert.deepEqual({ ...result }, { x: 30, z: 20 }, 'an open destination is kept exactly');
    assert.equal(ent.heading, 0.7);
    assert.equal(ent.speed, 0);
    assert.equal(Object.values(controller.keys).some(Boolean), false);
    assert.equal(controller._pressedCodes.size, 0);
    assert.deepEqual([ent.mesh.position.x, ent.mesh.position.y, ent.mesh.position.z], [ent.position.x, ent.position.y, ent.position.z]);
    assert.equal(ent.mesh.rotation.y, 0.7);
    if (mode === 'person') {
      assert.equal(ent.verticalVel, 0);
      assert.equal(ent.position.y, 0.22);
      assert.deepEqual(ent.rig.resetArgs.slice(0, 3), [30, 20, 0.7]);
      assert.equal(ent.rig.resetArgs[3](ent.rig.resetArgs[4], 30, 20), 0.22);
    } else if (mode === 'car') {
      for (const field of ['vx', 'vz', 'angularVel', 'steerAngle', 'pitchVel', 'rollVel', 'heaveY', 'heaveVel']) assert.equal(ent[field], 0, field);
      assert.equal(ent.chassisPivot.rotation.x, 0);
      assert.equal(ent.chassisPivot.rotation.z, 0);
      assert.equal(ent.chassisPivot.position.y, 0);
      assert.equal(ent.wheels[0].steerPivot.rotation.y, 0);
      assert.equal(ent.lastCollisionSpark, null);
    } else if (mode === 'cyclist') {
      assert.equal(ent.leanAngle, 0);
      assert.equal(ent.leanPivot.rotation.z, 0);
    } else {
      for (const field of ['verticalSpeed', 'pitchAngle', 'rollAngle']) assert.equal(ent[field], 0, field);
      assert.equal(ent.tiltPivot.rotation.x, 0);
      assert.equal(ent.tiltPivot.rotation.z, 0);
      assert.equal(ent.tiltPivot.position.y, 0);
      assert.equal(ent.position.y, 120, 'keep the helicopter altitude when already above the minimum');
    }
    const before = [ent.position.x, ent.position.y, ent.position.z, ent.heading];
    controller[`update${mode[0].toUpperCase()}${mode.slice(1)}`](0.1, 0);
    assert.deepEqual([ent.position.x, ent.position.y, ent.position.z, ent.heading], before, 'the first neutral frame stays at the arrival');
  });
}

test('teleport checks all overlapping buildings instead of leaving a sequential push trap', () => {
  const colliders = [
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 200 },
    { minX: 9, maxX: 20, minZ: 0, maxZ: 10, maxY: 200 }
  ];
  for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
    // Reverse order as well: a valid arrival must not rely on collider traversal order.
    for (const list of [colliders, colliders.slice().reverse()]) {
      const { controller, ent } = teleportHarness(mode, list.map(c => ({ ...c })));
      const result = controller.teleportActiveTo(11, 5, 0);
      assert.notDeepEqual({ ...result }, { x: 11, z: 5 });
      const before = [ent.position.x, ent.position.z];
      const radius = mode === 'helicopter' ? 4.5 : mode === 'person' ? 0.48 : 0.65;
      controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
      assert.deepEqual([ent.position.x, ent.position.z], before, `${mode} must already be collision-free`);
      assert.equal(ent.position.y, mode === 'helicopter' ? 120 : controller.getGroundHeight(result.x, result.z, mode));
    }
  }
});

test('teleports use oriented building footprints without rejecting clear corners of their bounds', () => {
  const cs = Math.SQRT1_2;
  const box = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, maxY: 200, obb: { cx: 0, cz: 0, hx: 8, hz: 2, cs, sn: cs } };
  for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
    const { controller, ent } = teleportHarness(mode, [{ ...box }]);
    assert.deepEqual({ ...controller.teleportActiveTo(7, 7, 0.6) }, { x: 7, z: 7 });
    const actual = controller.teleportActiveTo(0, 0, 0.6);
    const before = [actual.x, actual.z];
    controller.resolveHorizontalCollision(ent.position, mode === 'helicopter' ? 4.5 : mode === 'person' ? 0.48 : 0.65,
      mode === 'car' ? ent : null);
    assert.deepEqual([ent.position.x, ent.position.z], before);
  }
});

test('pedestrians pass clear building corners and resolve real corner hits radially', () => {
  const { controller, ent } = teleportHarness('person', [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 30 }]);
  ent.position.x = ent.position.z = -0.4;
  controller.resolveHorizontalCollision(ent.position, 0.48);
  assert.deepEqual([ent.position.x, ent.position.z], [-0.4, -0.4], 'distance to the corner exceeds the body radius');

  ent.position.x = ent.position.z = -0.2;
  controller.resolveHorizontalCollision(ent.position, 0.48);
  assert.ok(Math.abs(Math.hypot(ent.position.x, ent.position.z) - 0.48) < 1e-6);
  assert.ok(Math.abs(ent.position.x - ent.position.z) < 1e-6, 'a diagonal contact pushes along the corner normal');
});

test('corner collision normals follow an oriented building footprint', () => {
  const cs = Math.SQRT1_2;
  const { controller, ent } = teleportHarness('person', [{
    minX: -10 * cs, maxX: 10 * cs, minZ: -10 * cs, maxZ: 10 * cs, maxY: 30,
    obb: { cx: 0, cz: 0, hx: 5, hz: 5, cs, sn: cs }
  }]);
  // Local (-5.2, -5.2) lies just outside the rotated square's leftmost corner.
  ent.position.x = -10.4 * cs;
  ent.position.z = 0;
  controller.resolveHorizontalCollision(ent.position, 0.48);
  assert.ok(Math.abs(ent.position.x - (-10 * cs - 0.48)) < 1e-6);
  assert.ok(Math.abs(ent.position.z) < 1e-6, 'the correction must not slide sideways along the corner');
});

test('rotated cars use their own separating axes at building corners', () => {
  const { controller, ent } = teleportHarness('car', [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 30 }]);
  ent.heading = -Math.PI / 4;
  ent.speed = 0;
  ent.vx = ent.vz = 0;
  ent.position.x = ent.position.z = -1.8;
  controller.resolveHorizontalCollision(ent.position, 1.35, ent);
  assert.deepEqual([ent.position.x, ent.position.z], [-1.8, -1.8], 'the projected bounds overlap, but the actual car does not');

  ent.position.x = ent.position.z = -0.3;
  controller.resolveHorizontalCollision(ent.position, 1.35, ent);
  assert.ok(Math.abs(ent.position.x + 0.86 * Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(ent.position.z + 0.86 * Math.SQRT1_2) < 1e-6, 'the shortest correction is perpendicular to the car side');
});

test('teleports preserve clear rounded corners and separated rotated cars', () => {
  for (const [mode, coordinate, heading] of [['person', -0.45, 0], ['car', -1.8, -Math.PI / 4]]) {
    const { controller, ent } = teleportHarness(mode, [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 30 }]);
    const arrival = controller.teleportActiveTo(coordinate, coordinate, heading);
    assert.deepEqual({ ...arrival }, { x: coordinate, z: coordinate }, `${mode} has room including the arrival margin`);
    controller.resolveHorizontalCollision(ent.position, mode === 'person' ? 0.48 : 1.35, mode === 'car' ? ent : null);
    assert.deepEqual([ent.position.x, ent.position.z], [coordinate, coordinate], 'teleport clearance agrees with movement');

    const blocked = controller.teleportActiveTo(-0.2, -0.2, heading);
    assert.notDeepEqual({ ...blocked }, { x: -0.2, z: -0.2 }, 'a real corner overlap still needs a different arrival');
  }
});

test('movement and teleports pass underneath elevated building sections', () => {
  for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
    const { controller, ent } = teleportHarness(mode, [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, minY: 4, maxY: 30 }]);
    controller.getGroundHeight = () => 0;
    const y = mode === 'helicopter' ? 0.25 : 0;
    Object.assign(ent.position, { x: 5, y, z: 5 });
    controller.resolveHorizontalCollision(ent.position, mode === 'helicopter' ? 4.5 : 0.65, mode === 'car' ? ent : null);
    assert.deepEqual([ent.position.x, ent.position.z], [5, 5], `${mode} fits below the overhang`);
    assert.deepEqual({ ...controller.teleportActiveTo(5, 5, 0, y) }, { x: 5, z: 5 });
  }
});

test('building clearance uses the full player height beneath an overhang', () => {
  for (const [mode, height] of [['person', 1.9], ['car', 1.8], ['cyclist', 1.9], ['helicopter', 3.2]]) {
    const y = mode === 'helicopter' ? 0.25 : 0;
    const { controller, ent } = teleportHarness(mode, [{
      minX: 0, maxX: 10, minZ: 0, maxZ: 10, minY: y + height - 0.1, maxY: 30
    }]);
    controller.getGroundHeight = () => 0;
    Object.assign(ent.position, { x: 5, y, z: 5 });
    controller.resolveHorizontalCollision(ent.position, mode === 'helicopter' ? 4.5 : 0.65, mode === 'car' ? ent : null);
    assert.notDeepEqual([ent.position.x, ent.position.z], [5, 5], `${mode} intersects the underside`);
    assert.notDeepEqual({ ...controller.teleportActiveTo(5, 5, 0, y) }, { x: 5, z: 5 });
  }
});

test('players above a roof are clear once their body bottoms clear it', () => {
  for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
    const { controller, ent } = teleportHarness(mode, [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 10 }]);
    controller.getGroundHeight = () => 10.1;
    const y = mode === 'helicopter' ? 10.35 : 10.1;
    Object.assign(ent.position, { x: 5, y, z: 5 });
    controller.resolveHorizontalCollision(ent.position, mode === 'helicopter' ? 4.5 : 0.65, mode === 'car' ? ent : null);
    assert.deepEqual([ent.position.x, ent.position.z], [5, 5], `${mode} clears the visible roof`);
    assert.deepEqual({ ...controller.teleportActiveTo(5, 5, 0, y) }, { x: 5, z: 5 });
  }
});

test('helicopter skids cannot pass through a roof below the body origin', () => {
  const { controller, ent } = teleportHarness('helicopter', [{ minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 10 }]);
  Object.assign(ent.position, { x: 5, y: 10.2, z: 5 });
  controller.resolveHorizontalCollision(ent.position, 4.5);
  assert.notDeepEqual([ent.position.x, ent.position.z], [5, 5]);
  assert.notDeepEqual({ ...controller.teleportActiveTo(5, 5, 0, 10.2) }, { x: 5, z: 5 });
});

test('ground arrivals share movement shoreline limits while helicopters may remain above lower buildings', () => {
  const shore = z => ({ westX: -40 + z * 0.05, eastX: 40 + z * 0.05 });
  const { controller, ent } = teleportHarness('person', [], shore);
  const result = controller.teleportActiveTo(1000, -1000);
  assert.deepEqual({ ...result }, { x: 7, z: -500 }, 'clamped to the city bounds, then 8 m in from the shore');
  controller.resolveHorizontalCollision(ent.position, 0.48);
  assert.deepEqual([ent.position.x, ent.position.z], [result.x, result.z]);

  const heli = teleportHarness('helicopter', [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30, maxY: 50 }]);
  heli.ent.position.y = 10;
  assert.deepEqual({ ...heli.controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 });
  assert.equal(heli.ent.position.y, 92);
});

test('ground modes are pushed back to land in both coordinates, sliding to the shore margin', () => {
  const { controller, ent } = teleportHarness('car');
  // the water lies south of z = 100; clampToLand answers the centre of the nearest qualifying cell, as city-config does
  controller.activeMode = 'car';
  const harness = keyboardHarness({
    CITY_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
    clampToLand: (x, z, margin = 0) => ({ x: Math.round(x / 2) * 2 + 1, z: Math.min(z, 100 - margin - 1) }),
    isLand: (x, z, margin = 0) => z <= 100 - margin,
    blockAt: () => null
  });
  Object.setPrototypeOf(controller, Object.getPrototypeOf(harness.controller));
  Object.assign(ent.position, { x: 10.3, z: 96 });
  ent.speed = 10;
  controller.resolveHorizontalCollision(ent.position, 0.65, ent);
  assert.ok(Math.abs(ent.position.z - 92) < 0.1, `z ${ent.position.z} back to the margin, not past it`);
  assert.ok(Math.abs(ent.position.x - 10.3) < 0.1, `x ${ent.position.x} slides along the shore`);
  assert.ok(ent.speed < 10, 'scraping the shore slows the car');
  const heli = teleportHarness('helicopter');
  Object.assign(heli.ent.position, { x: -5000, z: -5000 });
  heli.controller.resolveHorizontalCollision(heli.ent.position, 4.5);
  assert.deepEqual([heli.ent.position.x, heli.ent.position.z], [-5000, -5000], 'the helicopter roams past the bounds alike in x and z');
});

test('a displaced pedestrian samples ground and resets its feet at the resolved destination', () => {
  const { controller, ent } = teleportHarness('person', [{ minX: -4, maxX: 0, minZ: -10, maxZ: 10, maxY: 30 }]);
  assert.deepEqual({ ...controller.teleportActiveTo(-1, 0) }, { x: 3, z: 0 });
  assert.equal(ent.position.y, 0.22, 'the requested point was on the higher ground, but the clear arrival is lower');
  assert.deepEqual(ent.rig.resetArgs.slice(0, 2), [3, 0]);
});

test('failed or invalid teleports keep the current position and stop the player with bounded search', () => {
  const { controller, ent } = teleportHarness('car', [{ minX: -300, maxX: 300, minZ: -300, maxZ: 300, maxY: 500 }]);
  let checks = 0;
  const near = controller.nearColliders;
  controller.nearColliders = function (...args) { checks++; return near.apply(this, args); };
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 400, z: 400 });
  assert.ok(checks <= 2049, 'the search must be bounded even inside an enormous obstacle');
  assert.equal(ent.speed, 0);
  assert.equal(ent.vx, 0);
  assert.equal(ent.angularVel, 0);
  assert.deepEqual({ ...controller.teleportActiveTo(NaN, Infinity) }, { x: 400, z: 400 });
});

test('successive mode teleports keep parked players out of the arrival and default chase view', () => {
  const { controller, ent: car } = teleportHarness('car');
  const person = teleportHarness('person').ent;
  const cyclist = teleportHarness('cyclist').ent;
  controller.entities = { car, person, cyclist };
  person.position.x = 300;
  cyclist.position.x = 200;
  const heading = Math.PI / 2; // The first radial candidate is +X: its rear camera would sit on the parked car.
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0, heading) }, { x: 0, z: 0 });
  const arrivals = [car];
  const radii = { car: 2.4, person: 0.48, cyclist: 1.0 };
  for (const mode of ['person', 'cyclist']) {
    controller.activeMode = mode;
    const ent = controller.entities[mode];
    const actual = controller.teleportActiveTo(0, 0, heading);
    assert.notDeepEqual({ ...actual }, { x: 0, z: 0 });
    for (const parked of arrivals) {
      const dx = parked.position.x - actual.x, dz = parked.position.z - actual.z;
      const cameraBack = Math.cos(0.09) * ent.chaseDistance;
      const along = Math.max(0, Math.min(cameraBack, -dx));
      assert.ok(Math.hypot(dx, dz) > radii[parked.type] + radii[mode], 'player bodies must not overlap');
      assert.ok(Math.hypot(dx + along, dz) > radii[parked.type] + 0.5, 'the complete default chase corridor must be clear');
    }
    assert.deepEqual([car.position.x, car.position.z], [0, 0], 'switching modes leaves the parked car in place');
    arrivals.push(ent);
  }
});

test('player clearance respects altitude and permits a ground arrival under an airborne helicopter', () => {
  const { controller, ent } = teleportHarness('person');
  const helicopter = teleportHarness('helicopter').ent;
  helicopter.position.x = helicopter.position.z = 0;
  helicopter.position.y = 120;
  controller.entities.helicopter = helicopter;
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 });
  assert.equal(ent.position.y, 0.22);
  helicopter.position.y = 1;
  assert.notDeepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 }, 'a helicopter parked at street level must be avoided');
});

// The square & park furniture built by city-grid.js (headless, with inert three.js stubs: only its colliders matter)
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

test('the player walks into the benches, lampposts, planters and tree trunks on Stary Rynek, not through them', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const logs = [];
  const { buildCityGrid } = loadModule(readFileSync(join(__dirname, '../js/city-grid.js'), 'utf8'), {
    imports: {
      'three/webgpu': inert(), 'three/addons/utils/BufferGeometryUtils.js': inert(), './city-config.js': config,
      './geodata.js': { GEO }, './tsl-materials.js': inert()
    },
    globals: { console: { info: (line) => logs.push(line), log() {}, warn() {} } },
    filename: 'city-grid.js'
  });
  const grid = buildCityGrid(inert());
  assert.equal(grid.colliders.length, 0, 'the furniture stays out of the colliders main.js hands the road network');
  const counts = /(\d+) benches, (\d+) lampposts, (\d+) park & plaza trees; (\d+) player colliders/.exec(logs.join('\n'));
  assert.ok(counts, 'the furniture counts are logged');
  const [benches, lamps, trees, total] = counts.slice(1).map(Number);
  assert.ok(benches > 100 && lamps > 1000 && trees > 5000, counts[0]);
  assert.equal(grid.propColliders.length, total);
  assert.equal(grid.propColliders.filter((c) => c.obb).length <= benches, true, 'only benches turn off the grid');

  // Stary Rynek: the square round the Ratusz at the origin (its edge ~70 m out)
  const rynek = grid.propColliders.filter((c) => Math.hypot((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) < 110);
  const bench = rynek.find((c) => c.obb && Math.abs(c.obb.hx - 0.95) < 1e-9);
  const lamp = rynek.find((c) => !c.obb && Math.abs(c.maxX - c.minX - 0.4) < 1e-9 && c.maxY > 4);
  const planter = rynek.find((c) => !c.obb && Math.abs(c.maxX - c.minX - 2.4) < 1e-9);
  assert.ok(bench && lamp && planter, 'Stary Rynek has benches, lampposts and planters');
  const cases = [
    [bench, bench.obb.cx, bench.obb.cz, bench.obb.hz],
    [lamp, (lamp.minX + lamp.maxX) / 2, (lamp.minZ + lamp.maxZ) / 2, 0.2],
    [planter, (planter.minX + planter.maxX) / 2, (planter.minZ + planter.maxZ) / 2, 1.2]
  ];
  const { controller, ent } = teleportHarness('person', grid.propColliders.map((c) => ({ ...c })));
  for (const [c, cx, cz, half] of cases) {
    // a walker 0.1 m from the prop's centre (across a bench: along its local z, the seat's depth)
    const ux = c.obb ? c.obb.sn : 1, uz = c.obb ? c.obb.cs : 0;
    ent.position.x = cx + ux * 0.1;
    ent.position.z = cz + uz * 0.1;
    ent.position.y = 0.24;
    controller.resolveHorizontalCollision(ent.position, 0.48, null, ent);
    const out = (ent.position.x - cx) * ux + (ent.position.z - cz) * uz;
    assert.ok(out >= half + 0.48 - 1e-6, `pushed ${out.toFixed(2)} m out of a ${c.maxY.toFixed(2)} m tall prop`);
    controller.resolveHorizontalCollision(ent.position, 0.48, null, ent);
    assert.ok(Math.abs((ent.position.x - cx) * ux + (ent.position.z - cz) * uz - out) < 1e-9, 'and then left in peace');
  }
  // a trunk stands in every planter, taller than a jump off it
  assert.ok(rynek.some((c) => c !== planter && c.minX > planter.minX && c.maxX < planter.maxX && c.minZ > planter.minZ &&
    c.maxZ < planter.maxZ && c.maxY > planter.maxY + 2), 'a trunk in the planter');
});

// The railway corridor keep-out (tram-infra.js railCorridor, passed as keepOut): a strip 10 < x < 20 with a road
// crossing it at |z| <= 3, where the track was cut
const railStrip = (x, z) => x > 10 && x < 20 && Math.abs(z) > 3;

test('ground modes cannot enter the railway corridor; the helicopter can', () => {
  for (const mode of ['person', 'car', 'cyclist', 'helicopter']) {
    const { controller, ent } = teleportHarness(mode);
    controller.keepOut = railStrip;
    controller.getGroundHeight = () => 0;
    const radius = mode === 'helicopter' ? 4.5 : mode === 'person' ? 0.48 : 0.65;
    Object.assign(ent.position, { x: 9, y: mode === 'helicopter' ? 120 : 0, z: 20 });
    controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
    // straight in: back out; diagonally in: slides along the edge
    ent.position.x = 11;
    controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
    if (mode === 'helicopter') {
      assert.equal(ent.position.x, 11, 'the helicopter flies over the corridor');
      continue;
    }
    assert.deepEqual([ent.position.x, ent.position.z], [9, 20], `${mode} stays out`);
    ent.position.x = 11;
    ent.position.z = 21;
    controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
    assert.deepEqual([ent.position.x, ent.position.z], [9, 21], `${mode} slides along the corridor's edge`);
    // a body found inside (restored or carried in) is moved to the nearest free ground
    ent.position.x = 12;
    ent.position.z = 40;
    controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
    assert.ok(!railStrip(ent.position.x, ent.position.z) && Math.abs(ent.position.x - 12) <= 3, `${mode} carried out`);
    // teleports never land inside
    const arrival = controller.teleportActiveTo(15, 30, 0);
    assert.ok(arrival && !railStrip(arrival.x, arrival.z), `${mode} arrives outside the corridor`);
  }
});

test('roads crossing a railway cut stay passable', () => {
  for (const mode of ['person', 'car', 'cyclist']) {
    const { controller, ent } = teleportHarness(mode);
    controller.keepOut = railStrip;
    controller.getGroundHeight = () => 0;
    const radius = mode === 'person' ? 0.48 : 0.65;
    Object.assign(ent.position, { x: 5, y: 0, z: 0 });
    for (let x = 5; x <= 25; x += 0.5) {
      ent.position.x = x;
      controller.resolveHorizontalCollision(ent.position, radius, mode === 'car' ? ent : null);
      assert.deepEqual([ent.position.x, ent.position.z], [x, 0], `${mode} crosses at x ${x}`);
    }
  }
});
