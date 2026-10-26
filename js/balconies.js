import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, color, attribute, uv, positionGeometry, normalGeometry,
  abs, fract, sin, pow, length, step, fwidth, max, mix
} from 'three/tsl';

// Wrought-iron balcony stacks on kamienica fronts: one balcony per storey, no stairs or ladders.
const MAX_STACKS = 2400;
const MAX_NEAR_BALCONIES = 256;
const NEAR_DISTANCE = 90;
const WIDTH = 2.4; // Default slab width; a record's optional `w` (clamped 1.5–3 m) scales the module across.
const BACK = -0.55; // The record sits 0.55 m off the facade: local z = BACK is the wall, +z points into the street.
const FRONT = 0.45; // 1.0 m deep slab.
const SLAB = 0.14;
const RAIL = 1.0;
const BAY = 0.12; // Baluster spacing.
const BAND = 0.6; // Railing height (fraction) where the ornament band starts.
const STYLES = 3; // Ring band, serpentine scroll, diamond lattice.
const STONE = 0x9a948a;
const IRON = 0x1b1d1f;

// One balcony: a stone slab (part 0) with masked iron railings on three sides (part 1) and two curved console
// brackets underneath (part 2). Railing uvs run in baluster bays across and 0..1 up; bracket uvs run 0..1 out from the
// wall and 0..1 down from the slab soffit.
function balconyGeometry() {
  const positions = [], uvs = [], parts = [], indices = [];
  function quad(a, b, c, d, part, width = 1) {
    const first = positions.length / 3;
    for (const p of [a, b, c, d]) positions.push(...p);
    uvs.push(0, 0, width, 0, width, 1, 0, 1);
    parts.push(part, part, part, part);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  function rail(x0, z0, x1, z1) {
    const bays = Math.round(Math.hypot(x1 - x0, z1 - z0) / BAY);
    quad([x0, 0, z0], [x1, 0, z1], [x1, RAIL, z1], [x0, RAIL, z0], 1, bays);
  }
  const x = WIDTH / 2, y = -SLAB;
  quad([-x, 0, BACK], [-x, 0, FRONT], [x, 0, FRONT], [x, 0, BACK], 0);
  quad([-x, y, BACK], [x, y, BACK], [x, y, FRONT], [-x, y, FRONT], 0);
  quad([-x, y, FRONT], [x, y, FRONT], [x, 0, FRONT], [-x, 0, FRONT], 0);
  quad([-x, y, BACK], [-x, y, FRONT], [-x, 0, FRONT], [-x, 0, BACK], 0);
  quad([x, y, FRONT], [x, y, BACK], [x, 0, BACK], [x, 0, FRONT], 0);
  const r = x - 0.03, f = FRONT - 0.03;
  rail(-r, f, r, f);
  rail(-r, BACK, -r, f);
  rail(r, f, r, BACK);
  for (const bx of [-(x - 0.3), x - 0.3]) {
    quad([bx, y, BACK], [bx, y, BACK + 0.7], [bx, y - 0.55, BACK + 0.7], [bx, y - 0.55, BACK], 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('balconyPart', new THREE.Float32BufferAttribute(parts, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function flagRange(attribute, count) {
  if (!count) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

// A bar of half width `halfWidth` that never drops below one pixel's footprint, so far railings fill in instead of
// shimmering.
const bar = (distance, halfWidth, footprint) => step(distance, max(halfWidth, footprint.mul(0.5)));

// Stone/iron surface split: colour, metalness and roughness all follow one 0..1 iron weight.
function ironSurface(material, iron) {
  material.colorNode = mix(color(STONE), color(IRON), iron);
  material.metalnessNode = mix(float(0), float(0.55), iron);
  material.roughnessNode = mix(float(0.85), float(0.5), iron);
}

export function createBalconies(group) {
  const nearMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const nearPart = attribute('balconyPart', 'float');
  ironSurface(nearMaterial, step(0.5, nearPart));
  nearMaterial.maskNode = Fn(() => {
    const part = attribute('balconyPart', 'float');
    const style = attribute('balconyStyle', 'float');
    const u = uv();
    const fy = fwidth(u.y);
    const pickets = bar(abs(fract(u.x.add(0.5)).sub(0.5)), 0.07, fwidth(u.x));
    const posts = bar(abs(fract(u.x.mul(0.5).add(0.5)).sub(0.5)), 0.035, fwidth(u.x).mul(0.5));
    const rails = max(
      bar(abs(u.y.sub(0.965)), 0.035, fy), bar(abs(u.y.sub(0.04)), 0.03, fy), bar(abs(u.y.sub(BAND)), 0.015, fy)
    );
    const m = vec2(u.x.mul(BAY), u.y.mul(RAIL));
    // Ring band: a circle between every pair of posts.
    const ring = length(vec2(fract(u.x.mul(0.5)).sub(0.5).mul(BAY * 2), m.y.sub(0.78)));
    const rings = bar(abs(ring.sub(0.1)), 0.011, fwidth(ring));
    // Serpentine scroll, one wave every four bays.
    const wave = m.y.sub(sin(u.x.mul(Math.PI / 2)).mul(0.11).add(0.78));
    const scroll = bar(abs(wave), 0.012, fwidth(wave));
    // Diamond lattice.
    const a = m.x.add(m.y).div(0.24), b = m.x.sub(m.y).div(0.24);
    const lattice = max(
      bar(abs(fract(a).sub(0.5)), 0.04, fwidth(a)), bar(abs(fract(b).sub(0.5)), 0.04, fwidth(b))
    );
    const motif = mix(mix(rings, scroll, step(0.5, style)), lattice, step(1.5, style));
    const band = step(BAND, u.y);
    const railing = max(rails, mix(pickets, max(motif, posts), band));
    // Console bracket: a concave quadrant tapering away from the wall, pierced by a round eye.
    const profile = step(u.y, pow(float(1).sub(u.x), 1.7)).mul(step(u.x, 0.97));
    const eye = step(length(vec2(u.x.sub(0.26), u.y.sub(0.36))), 0.1);
    const bracket = profile.mul(float(1).sub(eye));
    return mix(float(1), mix(railing, bracket, step(1.5, part)), step(0.5, part)).greaterThan(0.5);
  })();

  const geometry = balconyGeometry();
  const styleData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR_BALCONIES), 1);
  geometry.setAttribute('balconyStyle', styleData);
  const near = new THREE.InstancedMesh(geometry, nearMaterial, MAX_NEAR_BALCONIES);
  near.name = 'BalconiesNear';

  // Far proxy: one open box per stack, from the lowest slab soffit to the top rail; the mask draws a slab band and a
  // picket railing per storey on its front and sides.
  const farGeometry = new THREE.BoxGeometry(1, 1, 1);
  const farData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STACKS * 3), 3);
  farGeometry.setAttribute('balconySize', farData);
  const farUp = () => {
    const size = attribute('balconySize', 'vec3'); // Storey, box height, width.
    return fract(positionGeometry.y.add(0.5).mul(size.y).div(size.x)).mul(size.x);
  };
  const farMaterial = new THREE.MeshStandardNodeMaterial();
  ironSurface(farMaterial, Fn(() => step(SLAB, farUp()))());
  farMaterial.maskNode = Fn(() => {
    const size = attribute('balconySize', 'vec3');
    const up = farUp();
    const across = positionGeometry.x.add(0.5).mul(size.z);
    const front = abs(normalGeometry.z);
    const along = mix(positionGeometry.z.add(0.5).mul(FRONT - BACK), across, front);
    const r = up.sub(SLAB);
    const fy = fwidth(up);
    const pickets = bar(abs(fract(along.div(BAY).add(0.5)).sub(0.5)).mul(BAY), 0.008, fwidth(along));
    const rails = max(bar(abs(r.sub(RAIL * 0.965)), 0.035, fy), bar(abs(r.sub(RAIL * BAND)), 0.02, fy));
    const railing = max(pickets.mul(step(r, RAIL)), rails);
    const slab = step(up, SLAB);
    // Open top and bottom, and nothing between one railing and the next slab.
    return max(slab, railing).mul(step(abs(normalGeometry.y), 0.5)).greaterThan(0.5);
  })();
  const far = new THREE.InstancedMesh(farGeometry, farMaterial, MAX_STACKS);
  far.name = 'BalconiesFar';
  for (const mesh of [near, far]) {
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

  const dummy = new THREE.Object3D();
  const centre = (BACK + FRONT) / 2;
  let total = 0, nearCount = 0, farCount = 0;
  return {
    begin() {
      total = nearCount = farCount = 0;
    },
    // b: { x, y, z, ry?, facing, storey, landings, h, w?, style? } — see docs/world.md.
    add(b, focusX, focusZ) {
      if (total >= MAX_STACKS) return;
      total++;
      const dx = b.x - focusX, dz = b.z - focusZ;
      const angle = (b.ry || 0) + b.facing;
      const width = b.w ? Math.min(3, Math.max(1.5, b.w)) : WIDTH;
      dummy.rotation.set(0, angle, 0);
      if (dx * dx + dz * dz < NEAR_DISTANCE * NEAR_DISTANCE && nearCount + b.landings <= MAX_NEAR_BALCONIES) {
        // A stable per-stack motif, so every storey of a facade shares one railing pattern.
        const style = b.style !== undefined ? b.style % STYLES : Math.floor(Math.abs(b.x * 7.13 + b.z * 3.71)) % STYLES;
        dummy.scale.set(width / WIDTH, 1, 1);
        for (let i = 0; i < b.landings; i++) {
          dummy.position.set(b.x, b.y + i * b.storey, b.z);
          dummy.updateMatrix();
          near.setMatrixAt(nearCount, dummy.matrix);
          styleData.setX(nearCount++, style);
        }
      } else {
        const height = b.h - 1 + RAIL + SLAB;
        dummy.position.set(b.x + centre * Math.sin(angle), b.y - SLAB + height * 0.5, b.z + centre * Math.cos(angle));
        dummy.scale.set(width, height, FRONT - BACK);
        dummy.updateMatrix();
        far.setMatrixAt(farCount, dummy.matrix);
        farData.setXYZ(farCount++, b.storey, height, width);
      }
    },
    end() {
      near.count = nearCount;
      flagRange(near.instanceMatrix, nearCount);
      flagRange(styleData, nearCount);
      far.count = farCount;
      flagRange(far.instanceMatrix, farCount);
      flagRange(farData, farCount);
    }
  };
}
