import * as THREE from 'three/webgpu';
import { LANDMARK_SITES, LL } from './city-config.js';

// js/cameras.js
// Multi-camera system supporting Third-Person Chase (with mouse/touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, 8 fixed views of Poznań places and the Auto-Director Drone.

const CAMERA_PRESETS = [
  { id: 'chase',    name: '3rd-Person Chase',                short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'action',   name: 'Low-Angle Action',                short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',      name: 'First-Person / Cockpit',          short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'rynek',    name: 'Stary Rynek & Ratusz',            short: 'Stary Rynek', category: 'scenic', fov: 58 },
  { id: 'katedra',  name: 'Ostrów Tumski from Most Jordana', short: 'Katedra',     category: 'scenic', fov: 50 },
  { id: 'zamek',    name: 'Zamek Cesarski from Św. Marcin',  short: 'Zamek',       category: 'scenic', fov: 48 },
  { id: 'cytadela', name: 'Park Cytadela',                   short: 'Cytadela',    category: 'scenic', fov: 52 },
  { id: 'malta',    name: 'Jezioro Maltańskie',              short: 'Malta',       category: 'scenic', fov: 50 },
  { id: 'warta',    name: 'Warta Riverside',                 short: 'Warta',       category: 'scenic', fov: 50 },
  { id: 'baltyk',   name: 'Bałtyk Terrace',                  short: 'Bałtyk',      category: 'scenic', fov: 54 },
  { id: 'dworzec',  name: 'Poznań Główny & Avenida',         short: 'Dworzec',     category: 'scenic', fov: 52 },
  { id: 'drone',    name: 'Auto-Director Aerial',            short: 'Director',    category: 'scenic', fov: 50 }
];

// A point `y` m up at a landmark's site centre, or at (u, w) in its turned site frame: the frame fitToSite
// (landmark-kit.js) builds the models in, world = (x + u cos + w sin, z - u sin + w cos)
function onSite(name, y, u = 0, w = 0) {
  const s = LANDMARK_SITES[name];
  const c = Math.cos(s.ang || 0);
  const n = Math.sin(s.ang || 0);
  return { x: s.x + u * c + w * n, y, z: s.z - u * n + w * c };
}

// The fixed views of real places (world frame: x east, z south, 1 unit = 1 m; the Ratusz is the origin). `eye` drifts
// by `drift` = [dx, dz, rate] (m, rad/s) on a sine, `look` pans by `pan` the same way. Eye heights stay well under the
// 116 m skyline top (AND2); tests/cameras.test.cjs checks that every eye stands on land or over water, outside the
// building blocks, and looks at its place.
const PLACE_VIEWS = {
  // The east side of the square, by the Domki Budnicze, looking north-north-west at the Ratusz's tower and loggia
  rynek: { eye: { x: 22, y: 7, z: 58 }, look: onSite('Ratusz', 30), drift: [0, 4, 0.3] },
  // Most Biskupa Jordana (52.41158 N, 16.95088 E) over the Cybina, looking west at the cathedral's apse and towers
  katedra: { eye: { x: 1148, y: 8, z: -336 }, look: onSite('Katedra', 34), drift: [0, 3, 0.22] },
  // Św. Marcin at Kościuszki, looking west-north-west across the castle forecourt at the 75 m tower on its south-west
  // corner
  zamek: { eye: { x: -1000, y: 6.5, z: 150 }, look: { x: -1088, y: 42, z: 90 }, drift: [4, 0, 0.25] },
  // Over the park's northern lawns, 26 m up, looking south over its centre (52.4215 N, 16.9349 E) towards the Old Town
  cytadela: { eye: { x: 60, y: 26, z: -1690 }, look: { ...LL(16.9349, 52.4215), y: 2 }, drift: [6, 0, 0.12] },
  // The finish end of the regatta course, looking east-south-east down the 2.2 km lake
  malta: { eye: { x: 1700, y: 12, z: 340 }, look: { x: 2690, y: 4, z: 726 }, drift: [0, 8, 0.1] },
  // The west-bank boulevard below Chwaliszewo, looking north up the Warta to Most Chrobrego and Ostrów Tumski
  warta: { eye: { x: 745, y: 4.5, z: 15 }, look: { x: 752, y: 6, z: -220 }, drift: [0, 3, 0.15] },
  // Bałtyk's 15th-floor terrace (59 m deck, the east end of the south-west staircase), looking east-north-east over
  // Rondo Kaponiera at the Zamek Cesarski and the centre beyond
  baltyk: { eye: onSite('Bałtyk', 15 * 67 / 17 + 1.65, 10, -9.5), look: onSite('Zamek Cesarski', 30), pan: [0, 60, 0.18] },
  // Elevated view over Most Dworcowy looking south-east at the station hall, plaza and Avenida
  dworzec: { eye: { x: -1518, y: 26, z: 557 }, look: onSite('Poznań Główny', 6), drift: [3, 0, 0.2] }
};

// Where a place view's camera is and looks at `elapsed` s
function placeView(view, elapsed, pos, look) {
  const [dx, dz, rate] = view.drift || [0, 0, 0];
  const d = Math.sin(elapsed * rate);
  pos.set(view.eye.x + dx * d, view.eye.y, view.eye.z + dz * d);
  const [px, pz, panRate] = view.pan || [0, 0, 0];
  const p = Math.sin(elapsed * panRate);
  look.set(view.look.x + px * p, view.look.y, view.look.z + pz * p);
}


// The far plane reaches every corner of the outskirts (the city boundary, x -13.8…9.4 km, z -11.2…13.0 km) from
// anywhere the helicopter may fly (6 km past the 8.2 × 5.7 km detail box): 28.5 km at most to a boundary vertex
// (27.1 km round the 6.1 × 3.7 km box; 32.7 km to a corner of the boundary's bounding box, where there is no city).
// The horizon filler goes on to 40 km, but the aerial fog has swallowed it long before (tau ≥ 4.7 at 32 km even in the
// clearest preset, 380 m up), so its cut is never seen. Reversed float depth keeps the precision.
const CAMERA_FAR = 32000;

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      CAMERA_FAR
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    this.bindPointerControls();
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this.setCameraPreset('chase', true);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;

    switch (this.activePresetId) {
      case 'chase': {
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          Math.max(0.65, entity.position.y + height),
          entity.position.z - Math.cos(totalYaw) * horizDist
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 5.2,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(entity.heading) * 5.2
        );
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'drone': {
        // Circles the centre between the Old Town and the AND2/Andersia cluster at 125-155 m, just over the 116 m
        // skyline top (AND2, 486 m from the centre, stays inside the 580-860 m radius anyway)
        const angle = elapsed * 0.07 + 0.65;
        const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
        const alt = 140.0 + Math.cos(elapsed * 0.19) * 15.0;
        desiredPos.set(
          Math.cos(angle) * radius - 450.0,
          alt,
          Math.sin(angle) * radius + 350.0
        );
        desiredLook.set(-450.0, 30.0, 350.0);
        break;
      }

      default: {
        const view = PLACE_VIEWS[this.activePresetId];
        if (view) placeView(view, elapsed, desiredPos, desiredLook);
        break;
      }
    }

    if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const k = 1 - Math.exp(-dt * 8.5);
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}

export { CAMERA_PRESETS, PLACE_VIEWS, placeView, CameraSystem };
