import * as THREE from 'three/webgpu';
import { createFacadeBoxes } from './tsl-materials.js';
import { batchStaticGroupMeshes } from './city-grid.js';

// js/landmarks.js
// Hand-modelled landmark buildings, each fitted onto its real lot from city-config.js LANDMARK_SITES. The Manhattan
// models are gone; the Poznań ones (Ratusz, Katedra, Zamek, Bałtyk, …) arrive in Phase 7 and reuse the fitting and
// facade-box passes below.

// -------------------------------------------------------------------------------------------------------------------
// Every landmark is modelled around a local origin, then fitted onto its real lot (LANDMARK_SITES: the OpenStreetMap
// outline's box): scaled up to its real height (as wide as the real outline allows, about the model's centre) and moved
// so its centre stands on the outline's centre. Its colliders (colliders[c0..]) follow.
// A site may carry `ang` (radians, the same turn as a frontage frame's θ and three.js rotation.y): its w and d are then
// the outline's extents along the turned axes, and the model is turned by ang about the site centre (offset turns with
// it). Sites without ang take the unrotated path.
// -------------------------------------------------------------------------------------------------------------------
function fitToSite(objs, site, colliders, c0, { height, horizontal, stretch = false, offset = [0, 0] } = {}) {
  if (!site) return;
  const box = new THREE.Box3();
  for (const o of objs) {
    o.updateMatrixWorld(true);
    box.expandByObject(o);
  }
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const sy = height ? height / size.y : 1;
  let sx;
  let sz;
  if (stretch) {
    // fill the site's box exactly (parks & plazas)
    sx = site.w / size.x;
    sz = site.d / size.z;
  } else {
    // as tall as the real building, but never wider than its real outline (+6%) in either direction
    const fit = Math.min(site.w / size.x, site.d / size.z) * 1.06;
    sx = sz = horizontal ?? Math.min(sy, fit);
  }
  if (site.ang) {
    fitTurned(objs, site, colliders, c0, c, sx, sy, sz, offset);
    return;
  }
  const tx = site.x + offset[0];
  const tz = site.z + offset[1];
  for (const o of objs) {
    o.position.set(tx + (o.position.x - c.x) * sx, o.position.y * sy, tz + (o.position.z - c.z) * sz);
    o.scale.multiply(new THREE.Vector3(sx, sy, sz));
  }
  for (let i = c0; i < colliders.length; i++) {
    const k = colliders[i];
    const x0 = tx + (k.minX - c.x) * sx;
    const x1 = tx + (k.maxX - c.x) * sx;
    const z0 = tz + (k.minZ - c.z) * sz;
    const z1 = tz + (k.maxZ - c.z) * sz;
    k.minX = Math.min(x0, x1);
    k.maxX = Math.max(x0, x1);
    k.minZ = Math.min(z0, z1);
    k.maxZ = Math.max(z0, z1);
    k.maxY *= sy;
  }
}

// fitToSite on a turned site: scale in the site's own frame, then turn by ang about the site centre. Local (u, w) maps
// to world (x + u cos + w sin, z - u sin + w cos), as buildings.js does for frontage frames. The colliders, authored as
// model-space boxes, become oriented boxes inside their world AABB: the obb shape buildings.js pushCollider emits, which
// controllers.js and audio-acoustics.js test against and main.js keeps out of the traffic obstacles.
function fitTurned(objs, site, colliders, c0, c, sx, sy, sz, offset) {
  const cs = Math.cos(site.ang);
  const sn = Math.sin(site.ang);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), site.ang);
  for (const o of objs) {
    const u = offset[0] + (o.position.x - c.x) * sx;
    const w = offset[1] + (o.position.z - c.z) * sz;
    o.position.set(site.x + u * cs + w * sn, o.position.y * sy, site.z - u * sn + w * cs);
    o.scale.multiply(new THREE.Vector3(sx, sy, sz));
    o.quaternion.premultiply(turn);
  }
  for (let i = c0; i < colliders.length; i++) {
    const k = colliders[i];
    const u = offset[0] + ((k.minX + k.maxX) * 0.5 - c.x) * sx;
    const w = offset[1] + ((k.minZ + k.maxZ) * 0.5 - c.z) * sz;
    const cx = site.x + u * cs + w * sn;
    const cz = site.z - u * sn + w * cs;
    const hx = (k.maxX - k.minX) * 0.5 * Math.abs(sx);
    const hz = (k.maxZ - k.minZ) * 0.5 * Math.abs(sz);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    k.minX = cx - ex;
    k.maxX = cx + ex;
    k.minZ = cz - ez;
    k.maxZ = cz + ez;
    k.maxY *= sy;
    k.obb = { cx, cz, hx, hz, cs, sn };
  }
}

// Box-shaped facade parts (unrotated) become box-local facade boxes: every wall laid out in whole window bays between
// solid masonry corners, like the procedural blocks, so no window is cut by a corner. `boxLocalTwins` maps each
// world-space facade material to its `boxLocal: true` twin; rotated and non-box parts keep the world-space window grid.
function emitFacadeBoxes(group, boxLocalTwins) {
  group.updateMatrixWorld(true);
  const facadeBoxes = new Map();
  const boxParts = [];
  group.traverse((obj) => {
    if (obj.isMesh && boxLocalTwins.has(obj.material) && obj.geometry.type === 'BoxGeometry') boxParts.push(obj);
  });
  const partPos = new THREE.Vector3();
  const partRot = new THREE.Quaternion();
  const partScale = new THREE.Vector3();
  for (const m of boxParts) {
    m.matrixWorld.decompose(partPos, partRot, partScale);
    if (Math.abs(partRot.w) < 0.99999) continue;
    const { width, height, depth } = m.geometry.parameters;
    const twin = boxLocalTwins.get(m.material);
    if (!facadeBoxes.has(twin)) facadeBoxes.set(twin, []);
    facadeBoxes.get(twin).push({ x: partPos.x, y: partPos.y, z: partPos.z, w: width * partScale.x, h: height * partScale.y, d: depth * partScale.z });
    m.removeFromParent();
  }
  for (const [mat, boxes] of facadeBoxes) {
    const inst = createFacadeBoxes(mat, boxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
}

// No landmark models yet (Phase 7), so the group is empty and there are no colliders; the finishing passes still run so
// the models only have to be added here.
function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'Landmarks';
  const colliders = [];

  emitFacadeBoxes(group, new Map());
  batchStaticGroupMeshes(group, new Set());

  scene.add(group);
  return { group, colliders };
}

export { buildLandmarks, fitToSite };
