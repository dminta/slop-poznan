import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';

// js/canopies.js
// Open platform, tram-stop, petrol-station and market canopies from the OSM building=roof outlines (GEO.canopies).
// buildings.js leaves those footprints out of the built mass because they have no walls; this module gives them the
// light roof slab and regular column grid the stations and forecourts actually have. A canopy is an oriented
// rectangle (cx, cz, w, d, ang) with a metal deck whose underside is `clearance` above the ground and whose top is
// `h`. The columns are GEO.canopies' audited 0.4 m posts; tools/poz-canopies.mjs keeps every one at least 2.6 m from
// every rail centreline, so no pillar stands in a running line. Vehicles and pedestrians pass underneath: the roof
// collider starts at the clearance, above the tallest ground actor.
//
// The whole set is three instanced meshes (roof decks, concrete columns, steel columns) plus one instanced beam family,
// all under the static Canopies root, so scene culling chunks it with the rest of the city and no per-frame update is
// needed.

const UP = new THREE.Vector3(0, 1, 0);
const ROOF_TINT = {
  platform: 0x8d999b,
  tram: 0x7c8a8a,
  fuel: 0xd8d2c4,
  market: 0xa89b84,
  shelter: 0x87938b,
  roof: 0x8c938f
};
const CONCRETE = 0x9a958c;
const STEEL = 0x555b5d;

function canopyColumns(canopy) {
  return canopy.columns || [];
}

/**
 * Build every GEO.canopies record as static instanced geometry.
 * @param {import('three/webgpu').Scene} scene
 * @returns {{ group: THREE.Group, colliders: Array<object>, count: number }}
 */
function buildCanopies(scene) {
  const group = new THREE.Group();
  group.name = 'Canopies';
  const list = GEO.canopies || [];
  const colliders = [];
  if (!list.length) {
    scene.add(group);
    return { group, colliders, count: 0 };
  }

  const roofMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.42 });
  const concreteMaterial = new THREE.MeshStandardNodeMaterial({ color: CONCRETE, roughness: 0.82, metalness: 0.05 });
  const steelMaterial = new THREE.MeshStandardNodeMaterial({ color: STEEL, roughness: 0.48, metalness: 0.62 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const identity = new THREE.Quaternion();

  let concreteCount = 0;
  let steelCount = 0;
  for (const c of list) {
    const n = canopyColumns(c).length / 2;
    if (c.kind === 'platform') concreteCount += n;
    else steelCount += n;
  }

  const roofs = new THREE.InstancedMesh(unitBox, roofMaterial, list.length);
  const concrete = concreteCount ? new THREE.InstancedMesh(unitBox, concreteMaterial, concreteCount) : null;
  const steel = steelCount ? new THREE.InstancedMesh(unitBox, steelMaterial, steelCount) : null;
  // Two edge beams per canopy make the deck read as a supported slab rather than a floating plate.
  const beams = new THREE.InstancedMesh(unitBox, steelMaterial, list.length * 2);
  for (const mesh of [roofs, concrete, steel, beams]) {
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  roofs.name = 'CanopyRoofs';
  if (concrete) concrete.name = 'CanopyColumnsConcrete';
  if (steel) steel.name = 'CanopyColumnsSteel';
  beams.name = 'CanopyBeams';

  let ci = 0, si = 0, bi = 0;
  list.forEach((c, i) => {
    const rotation = -c.ang;
    const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
    quaternion.setFromAxisAngle(UP, rotation);
    const thickness = Math.max(0.3, c.h - c.clearance);
    matrix.compose(
      position.set(c.cx, c.clearance + thickness * 0.5, c.cz),
      quaternion,
      scale.set(c.w, thickness, c.d)
    );
    roofs.setMatrixAt(i, matrix);
    roofs.setColorAt(i, colour.setHex(ROOF_TINT[c.kind] ?? ROOF_TINT.roof));

    const cols = canopyColumns(c);
    for (let k = 0; k + 1 < cols.length; k += 2) {
      const x = cols[k], z = cols[k + 1];
      matrix.compose(position.set(x, c.clearance * 0.5, z), identity, scale.set(0.4, c.clearance, 0.4));
      if (c.kind === 'platform') {
        concrete.setMatrixAt(ci++, matrix);
      } else {
        steel.setMatrixAt(si++, matrix);
      }
      colliders.push({
        minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2,
        minY: 0, maxY: c.clearance
      });
    }

    // The two long-edge beams sit just under the deck, at the column rows' line.
    const off = Math.max(0.35, c.d * 0.5 - 0.7);
    for (const v of [-off, off]) {
      const x = c.cx - v * sn;
      const z = c.cz + v * cs;
      matrix.compose(
        position.set(x, c.clearance - 0.14, z),
        quaternion,
        scale.set(c.w - 0.8, 0.28, 0.22)
      );
      beams.setMatrixAt(bi++, matrix);
    }

    // Roof as one world box: it starts above a train/tram body and a walking player, so it is not an obstacle for
    // ground modes; it is kept so a flying camera cannot pass through the deck.
    colliders.push({
      minX: c.x0, maxX: c.x1, minZ: c.z0, maxZ: c.z1,
      minY: c.clearance, maxY: c.h
    });
  });

  roofs.instanceMatrix.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  for (const mesh of [concrete, steel, beams]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  group.add(roofs);
  if (concrete) group.add(concrete);
  if (steel) group.add(steel);
  group.add(beams);
  scene.add(group);
  return { group, colliders, count: list.length };
}

export { buildCanopies, canopyColumns };
