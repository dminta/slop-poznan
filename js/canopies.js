import * as THREE from 'three/webgpu';
import { color, float, mix, normalGeometry, smoothstep, step } from 'three/tsl';
import { GEO } from './geodata.js';
import { cityUniforms } from './tsl-materials.js';

// js/canopies.js
// Open platform, tram-stop, petrol-station and market canopies from the OSM building=roof outlines (GEO.canopies).
// buildings.js leaves those footprints out of the built mass because they have no walls; this module gives them the
// light roof slab and regular column grid the stations and forecourts actually have. A canopy is an oriented
// rectangle (cx, cz, w, d, ang) with a metal deck whose underside is `clearance` above the ground and whose top is
// `h`. The columns are GEO.canopies' audited 0.4 m posts; tools/poz-canopies.mjs keeps every one at least 2.6 m from
// every rail centreline, so no pillar stands in a running line. Vehicles and pedestrians pass underneath: the roof
// collider starts at the clearance, above the tallest ground actor.
//
// Roofs, columns, beams and soffit fixtures use instanced meshes under the static Canopies root. Fixture positions
// also feed the shared street-light pool; the geometry itself needs no per-frame update.

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

function canopyFixtureSites(list) {
  const sites = [];
  for (const c of list) {
    // Long narrow ordinary roofs include the Komedy and Ławica walkways whose lamps were removed.
    if (c.kind !== 'platform' && c.kind !== 'tram' &&
        !(c.kind === 'roof' && c.w >= 30 && c.d <= 10)) continue;
    const n = Math.max(1, Math.ceil(c.w / 7.5));
    const rows = c.d >= 14 ? [-c.d * 0.3, c.d * 0.3] : [0];
    const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
    const columns = canopyColumns(c);
    for (const v of rows) {
      for (let i = 0; i < n; i++) {
        const nominal = ((i + 0.5) / n - 0.5) * c.w;
        let u = null;
        // Keep the 1.4 m housing clear of posts, moving along the row without leaving the deck.
        for (const shift of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.25, -1.25, 1.5, -1.5]) {
          const candidate = nominal + shift;
          if (Math.abs(candidate) + 0.7 > c.w * 0.5) continue;
          const x = c.cx + candidate * cs - v * sn, z = c.cz + candidate * sn + v * cs;
          let clear = true;
          for (let k = 0; k + 1 < columns.length; k += 2) {
            if (Math.hypot(x - columns[k], z - columns[k + 1]) < 1) { clear = false; break; }
          }
          if (clear) { u = candidate; break; }
        }
        if (u === null) continue;
        sites.push({ x: c.cx + u * cs - v * sn, y: c.clearance - 0.06,
          z: c.cz + u * sn + v * cs, ang: c.ang });
      }
    }
  }
  return sites;
}

/**
 * Build every GEO.canopies record as static instanced geometry.
 * @param {import('three/webgpu').Scene} scene
 * @returns {{ group: THREE.Group, colliders: Array<object>, count: number, fixtureSites: Array<object> }}
 */
function buildCanopies(scene) {
  const group = new THREE.Group();
  group.name = 'Canopies';
  const list = GEO.canopies || [];
  const colliders = [];
  const fixtureSites = canopyFixtureSites(list);
  if (!list.length) {
    scene.add(group);
    return { group, colliders, count: 0, fixtureSites };
  }

  const roofMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.42 });
  // Painted underside is matte; retain the original finish on the top and edges. All instances stay in one draw.
  const underside = step(normalGeometry.y, -0.5);
  roofMaterial.roughnessNode = mix(float(0.5), float(0.85), underside);
  roofMaterial.metalnessNode = mix(float(0.42), float(0.05), underside);
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
  const fixtureMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xc6c8c3, roughness: 0.7 });
  fixtureMaterial.emissiveNode = color(0xffe8c2).mul(smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow)).mul(1.6);
  const fixtures = fixtureSites.length ? new THREE.InstancedMesh(unitBox, fixtureMaterial, fixtureSites.length) : null;
  for (const mesh of [roofs, concrete, steel, beams]) {
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  roofs.name = 'CanopyRoofs';
  if (concrete) concrete.name = 'CanopyColumnsConcrete';
  if (steel) steel.name = 'CanopyColumnsSteel';
  beams.name = 'CanopyBeams';
  if (fixtures) {
    fixtures.name = 'CanopyFixtures';
    fixtureSites.forEach((s, i) => {
      quaternion.setFromAxisAngle(UP, -s.ang);
      matrix.compose(position.set(s.x, s.y, s.z), quaternion, scale.set(1.4, 0.1, 0.22));
      fixtures.setMatrixAt(i, matrix);
    });
    fixtures.instanceMatrix.needsUpdate = true;
  }

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
  if (fixtures) group.add(fixtures);
  scene.add(group);
  return { group, colliders, count: list.length, fixtureSites };
}

export { buildCanopies, canopyColumns, canopyFixtureSites };
