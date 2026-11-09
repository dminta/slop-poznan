import * as THREE from 'three/webgpu';
import { batchStaticGroupMeshes } from './city-grid.js';
import { createLandmarkMaterials, emitFacadeBoxes } from './landmark-kit.js';
import { buildRynekLandmarks } from './landmarks-rynek.js';
import { buildHeritageLandmarks } from './landmarks-heritage.js';
import { buildCentrumLandmarks } from './landmarks-centrum.js';
import { buildDworzecLandmarks } from './landmarks-dworzec.js';
import { buildTowerLandmarks } from './landmarks-towers.js';
import { buildHistoricLandmarks } from './landmarks-historic.js';
import { buildStadiumLandmarks } from './landmarks-stadium.js';

// js/landmarks.js
// Hand-modelled Poznań landmarks, each fitted onto its real OpenStreetMap lot (city-config.js LANDMARK_SITES). The
// models live in the landmarks-*.js area modules on the toolkit of landmark-kit.js (conventions there); this module
// builds them into the `Landmarks` root, runs the facade-box and batching passes, and drives the animated parts.

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'Landmarks';
  // Moving parts (the Ratusz goats): a separate root, so they are neither merged into the static batches nor culled
  // as static geometry
  const dynamic = new THREE.Group();
  dynamic.name = 'LandmarksDynamic';
  const colliders = [];
  const M = createLandmarkMaterials();
  const ctx = { group, dynamic, colliders, M };

  const updates = [
    buildRynekLandmarks(ctx),
    buildHeritageLandmarks(ctx),
    buildCentrumLandmarks(ctx),
    buildDworzecLandmarks(ctx),
    buildTowerLandmarks(ctx),
    buildHistoricLandmarks(ctx),
    buildStadiumLandmarks(ctx)
  ].filter(Boolean);

  emitFacadeBoxes(group, M.boxLocalTwins);
  batchStaticGroupMeshes(group, new Set([M.steel, M.gold]));

  scene.add(group);
  scene.add(dynamic);
  // presetId: the lighting preset (lighting.js TIME_PRESETS key); the goats butt heads at noon
  const update = (dt, elapsed, presetId) => {
    for (const u of updates) u(dt, elapsed, presetId);
  };
  return { group, colliders, update };
}

export { buildLandmarks };
