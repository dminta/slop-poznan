const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');
let cityConfig;
let GEO;
test.before(async () => {
  cityConfig = await import('../js/city-config.js');
  ({ GEO } = await import('../js/geodata.js'));
});

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  subVectors(a, b) { return this.copy(a).sub(b); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
}

class PerspectiveCamera {
  constructor(fov, aspect) {
    this.fov = fov;
    this.aspect = aspect;
    this.position = new Vector3();
    this.target = new Vector3();
  }
  updateProjectionMatrix() {}
  lookAt(v) { this.target.copy(v); }
}

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

function cameraHarness(entity = {
  position: new Vector3(0, 0, 100), heading: 0, speed: 0, type: 'car',
  chaseDistance: 6.9, chaseHeight: 2.12, cameraTargetOffset: new Vector3(0, 1, 0)
}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const canvas = { ...eventTarget(), style: {} };
  const controls = eventTarget();
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  window.innerWidth = 1600;
  window.innerHeight = 900;
  const { CameraSystem } = loadModule(source, {
    globals: { window, document },
    imports: { 'three/webgpu': { Vector3, PerspectiveCamera }, './city-config.js': cityConfig }
  });
  const camera = new CameraSystem(canvas, { getActiveEntity: () => entity });
  return {
    camera, canvas, controls, window, document, captured, entity,
    pointer(target, type, id, x, y = 0, pointerType = 'touch', button = 0) {
      const event = {
        pointerId: id, clientX: x, clientY: y, pointerType, button,
        prevented: false, preventDefault() { this.prevented = true; }
      };
      // Captured pointers keep reaching the canvas after moving over the controls.
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
      return event;
    }
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('UI touches neither move nor release an active canvas orbit', () => {
  const h = cameraHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.controls, 'pointerdown', 1, 20);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  assert.equal(h.captured.has(1), false);
  assert.equal(h.captured.has(2), true);

  h.pointer(h.controls, 'pointermove', 1, 300);
  close(h.camera.orbitYawOffset, 0);
  h.pointer(h.controls, 'pointerup', 1, 300);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.controls, 'pointermove', 2, 110);
  close(h.camera.orbitYawOffset, -0.065);
  h.pointer(h.controls, 'pointerup', 2, 110);
  assert.equal(h.camera.isDragging, false);
});

test('two canvas touches pinch without orbiting and one remaining touch resumes smoothly', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  close(h.camera.zoomMultiplier, 0.5);
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  h.pointer(h.canvas, 'pointermove', 1, 100);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerup', 2, 200);
  h.pointer(h.canvas, 'pointermove', 1, 110);
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.zoomMultiplier, 1);
});

test('extra fingers are ignored and coincident pinch points keep zoom finite', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointerdown', 3, 300);
  h.pointer(h.canvas, 'pointermove', 3, 500);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointermove', 2, 0);
  h.pointer(h.canvas, 'pointermove', 2, 10);
  assert.equal(Number.isFinite(h.camera.zoomMultiplier), true);
  h.pointer(h.canvas, 'pointerup', 3, 500);
  assert.equal(h.camera.isDragging, true);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
  test(`${interruption} ends capture without a stuck drag or jump on the next gesture`, () => {
    const h = cameraHarness();
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 10);
    if (interruption === 'blur' || interruption === 'hidden') h.pointer(h.canvas, 'pointerdown', 3, 100);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1, 10);
    assert.equal(h.camera.isDragging, false);
    assert.equal(h.captured.size, 0);
    h.pointer(h.canvas, 'pointermove', 1, 500);
    close(h.camera.orbitYawOffset, -0.065);
    h.pointer(h.canvas, 'pointerdown', 2, 600);
    h.pointer(h.canvas, 'pointermove', 2, 610);
    close(h.camera.orbitYawOffset, -0.13);
  });
}

test('cancelling one pinch pointer leaves the other ready for orbit', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 1, 20);
  h.pointer(h.canvas, 'pointercancel', 2, 100);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.canvas, 'pointermove', 1, 30);
  close(h.camera.orbitYawOffset, -0.065);
});

test('mouse orbit and wheel zoom retain their behavior and bounds', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse', 2);
  assert.equal(h.camera.isDragging, false);
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse');
  h.pointer(h.canvas, 'pointermove', 1, 10, 20, 'mouse');
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.orbitPitchOffset, 0.19);
  h.pointer(h.canvas, 'pointerup', 1, 10, 20, 'mouse');
  let prevented = false;
  h.canvas.dispatch('wheel', { deltaY: 100, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  close(h.camera.zoomMultiplier, 1.1);
  h.canvas.dispatch('wheel', { deltaY: -10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 0.45);
  h.canvas.dispatch('wheel', { deltaY: 10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 2.4);
});

for (const preset of ['chase', 'baltyk', 'drone']) {
  test(`teleport after driving, orbiting and ${preset} snaps to a fresh chase view`, () => {
    const h = cameraHarness();
    h.entity.speed = 45;
    for (let i = 0; i < 180; i++) h.camera.update(1 / 60, i / 60);
    assert.ok(h.camera.smoothedSpeed > 44);
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 200, 80);
    h.pointer(h.canvas, 'pointerup', 1, 200, 80);
    h.canvas.dispatch('wheel', { deltaY: 1000, preventDefault() {} });
    h.camera.setCameraPreset(preset, true);
    h.camera.update(1 / 60, 4);

    h.entity.position.set(-200, 20, 5300);
    h.entity.heading = -Math.PI / 2;
    h.entity.speed = 0;
    h.camera.resetForTeleport();
    const fresh = cameraHarness(h.entity).camera;
    assert.equal(h.camera.activePresetId, 'chase');
    assert.equal(h.camera.camera.fov, fresh.camera.fov);
    // Compare arrival, follow re-anchoring, and movement after arrival, including a change in height.
    for (let i = 0; i < 3; i++) {
      if (i === 2) h.entity.position.set(-205, 23, 5304);
      h.camera.update(1 / 60, 5 + i / 60);
      fresh.update(1 / 60, 5 + i / 60);
      for (const field of ['currentPos', 'currentLookAt']) {
        for (const axis of ['x', 'y', 'z']) close(h.camera[field][axis], fresh[field][axis]);
      }
      for (const axis of ['x', 'y', 'z']) {
        close(h.camera.camera.position[axis], fresh.camera.position[axis]);
        close(h.camera.camera.target[axis], fresh.camera.target[axis]);
      }
    }
  });
}

test('teleport releases every camera pointer and ignores old gestures before accepting a new drag', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointermove', 1, 20, 40);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  assert.equal(h.captured.size, 2);
  h.camera.resetForTeleport();
  assert.equal(h.captured.size, 0);
  assert.equal(h.camera.isDragging, false);
  assert.equal(h.camera.userOrbitTimer, 0);
  for (const id of [1, 2]) {
    h.pointer(h.canvas, 'pointermove', id, 500, 500);
    h.pointer(h.canvas, 'pointerup', id, 500, 500);
  }
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerdown', 3, 600);
  h.pointer(h.canvas, 'pointermove', 3, 610);
  close(h.camera.orbitYawOffset, -0.065);
  assert.equal(h.camera.isDragging, true);
});

function inRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

// What each place view must look at: a LANDMARK_SITES footprint, a named park or a named water body
const PLACES = {
  rynek: { site: 'Ratusz' },
  katedra: { site: 'Katedra' },
  zamek: { site: 'Zamek Cesarski' },
  cytadela: { park: 'Park Cytadela' },
  malta: { water: 'Jezioro Maltańskie' },
  warta: { water: 'Warta' },
  baltyk: { site: 'Zamek Cesarski', standsOn: 'Bałtyk' },
  dworzec: { site: 'Poznań Główny' }
};

test('the camera buttons and digit shortcuts name existing presets', () => {
  const ids = [...readFileSync(join(__dirname, '../index.html'), 'utf8').matchAll(/data-camera="([^"]+)"/g)].map((m) => m[1]);
  const { CAMERA_PRESETS } = loadModule(source, {
    globals: { window: {}, document: {} },
    imports: { 'three/webgpu': { Vector3, PerspectiveCamera }, './city-config.js': cityConfig }
  });
  assert.deepEqual(ids, [...CAMERA_PRESETS.map((p) => p.id)]);
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  const bound = [...main.matchAll(/selectCamera\('([^']+)', true\)/g)].map((m) => m[1]);
  assert.ok(bound.includes('rynek') && bound.includes('katedra') && bound.includes('zamek'));
  for (const id of bound) assert.ok(ids.includes(id), id);
  const scenic = CAMERA_PRESETS.filter((p) => p.category === 'scenic' && p.id !== 'drone').map((p) => p.id);
  assert.deepEqual([...scenic].sort(), Object.keys(PLACES).sort());
});

test('every place view stands on land or over water, outside buildings, and looks at its place', () => {
  const { LANDMARK_SITES, isLand, isWater, waterAt, blockAt } = cityConfig;
  const h = cameraHarness();
  for (const [id, want] of Object.entries(PLACES)) {
    h.camera.setCameraPreset(id, true);
    for (let t = 0; t < 60; t += 0.5) {
      h.camera.update(1 / 60, t);
      const eye = h.camera.camera.position;
      const look = h.camera.camera.target;
      const where = `${id} at t = ${t}`;
      assert.ok(isLand(eye.x, eye.z) || isWater(eye.x, eye.z) || waterAt(eye.x, eye.z), `${where}: eye on land or water`);
      const dist = Math.hypot(look.x - eye.x, look.z - eye.z);
      assert.ok(dist > 40 && dist < 1200, `${where}: looks ${dist.toFixed(0)} m away`);
      if (want.standsOn) {
        // A terrace view: on the landmark's outline, below its top
        const s = LANDMARK_SITES[want.standsOn];
        assert.ok(inRing(s.ring, eye.x, eye.z), `${where}: on ${want.standsOn}`);
        assert.ok(eye.y > 55 && eye.y < s.h, `${where}: terrace height ${eye.y}`);
      } else {
        assert.ok(eye.y >= 3 && eye.y <= 40, `${where}: eye height ${eye.y}`);
        const block = blockAt(eye.x, eye.z);
        assert.ok(!block || block.park >= 0.5, `${where}: eye outside building blocks`);
        for (const [name, s] of Object.entries(LANDMARK_SITES)) {
          if (s.ring) assert.ok(!inRing(s.ring, eye.x, eye.z), `${where}: eye inside ${name}`);
        }
      }
      if (want.site) {
        const s = LANDMARK_SITES[want.site];
        const off = Math.hypot(look.x - s.x, look.z - s.z);
        assert.ok(off < Math.max(s.w, s.d) / 2 + 10, `${where}: looks ${off.toFixed(0)} m off ${want.site}`);
        assert.ok(look.y > 0 && look.y < s.h, `${where}: look height`);
      } else if (want.water) {
        assert.equal(waterAt(look.x, look.z)?.name, want.water, `${where}: looks over ${want.water}`);
      } else {
        const park = GEO.parks.find((p) => p.name === want.park);
        assert.ok(park.rings.some((r) => inRing(r, look.x, look.z)), `${where}: looks into ${want.park}`);
      }
    }
  }
});

test('the drone circles just above the 116 m skyline top', () => {
  const h = cameraHarness();
  h.camera.setCameraPreset('drone', true);
  for (let t = 0; t < 200; t += 0.5) {
    h.camera.update(1 / 60, t);
    const y = h.camera.camera.position.y;
    assert.ok(y > 116 + 8 && y < 160, `drone at ${y}`);
  }
});
