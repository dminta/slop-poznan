import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
import { addMesh, box, cylinder } from './landmark-kit.js';

// Piotrowo A23/A23a and A29. OSM's actual curved outlines and open patios, rather than their bounding boxes, define
// the walls and roofs. Shared landmark materials supply the same time-of-day window glow without new light pools.
const PIOTROWO_NAMES = ['Centrum Wykładowe PP', 'Biblioteka Techniczna PP', 'Hala Sportowa PP'];

function points(flat, site) {
  const p = [];
  for (let i = 0; i < flat.length; i += 2) p.push([flat[i] - site.x, flat[i + 1] - site.z]);
  return p;
}

function inside(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

function slab(group, ring, holes, y, height, material) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return addMesh(group, geometry, material, 0, y, 0);
}

// Thin oriented wall colliders follow every straight/curved outline segment, including courtyard walls. Interior
// scanline runs prevent map-click/restored players appearing inside. They do not block the patios or entrance recess.
function buildColliders(colliders, s, rings, minY, maxY) {
  const wall = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    const cx = s.x + (a[0] + b[0]) / 2, cz = s.z + (a[1] + b[1]) / 2;
    const hx = length / 2, hz = 0.12, cs = dx / length, sn = -dz / length;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY,
      obb: { cx, cz, hx, hz, cs, sn } });
  };
  for (const ring of rings) for (let i = 0; i < ring.length; i++) wall(ring[i], ring[(i + 1) % ring.length]);
  const outer = rings[0];
  const z0 = Math.min(...outer.map((p) => p[1])), z1 = Math.max(...outer.map((p) => p[1]));
  for (let z = z0 + 0.25; z < z1; z += 0.5) {
    const crossings = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] > z) !== (b[1] > z)) crossings.push(a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      colliders.push({ minX: s.x + crossings[i], maxX: s.x + crossings[i + 1],
        minZ: s.z + z - 0.25, maxZ: s.z + z + 0.25, minY, maxY });
    }
  }
}

function buildPiotrowoLandmarks({ group, colliders, M }) {
  for (const name of PIOTROWO_NAMES) {
    const s = LANDMARK_SITES[name];
    if (!s) continue;
    const obj = new THREE.Group();
    obj.name = name;
    obj.position.set(s.x, 0, s.z);
    group.add(obj);
    const ring = points(s.ring, s), holes = (s.holes || []).map((h) => points(h, s));
    const sport = name === 'Hala Sportowa PP';
    const lecture = name === 'Centrum Wykładowe PP';
    const base = 0.24, roof = lecture ? s.h - 1.3 : s.h - 0.4;
    const lower = ring.map((p) => p.slice());
    if (lecture) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        if ((a[0] + b[0]) / 2 > -20 || length < 40) continue;
        for (const j of [i, (i + 1) % ring.length]) {
          lower[j][0] += dz / length * 3;
          lower[j][1] -= dx / length * 3;
        }
      }
      slab(obj, lower, holes, base, 3.4 - base, M.facade.glassGreen);
      slab(obj, ring, holes, 3.4, roof - 3.64, M.facade.glassGreen);
    } else {
      slab(obj, ring, holes, base, roof - base - 0.24, M.facade.glassGreen);
    }
    slab(obj, ring, holes, roof - 0.24, 0.24, M.zinc);
    // Cream vertical piers frame the tall green glass bays at the library and the lower lecture wings. On the
    // sports hall a dark upper cladding band and a glazed ground-floor ribbon replace the tall window rhythm.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 0.5) continue;
      const ry = Math.atan2(-dz, dx), x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      box(obj, length, 0.5, 0.28, M.plasterCream, x, roof - 0.74, z, ry);
      if (sport) {
        box(obj, length, 3.8, 0.24, M.darkMetal, x, roof - 4.55, z, ry);
        box(obj, length, 0.8, 0.3, M.concrete, x, base, z, ry);
        box(obj, length, 0.6, 0.28, M.concrete, x, 3.2, z, ry);
        for (let y = roof - 4.35; y < roof - 0.8; y += 0.32) {
          box(obj, length, 0.06, 0.32, M.zinc, x, y, z, ry);
        }
        const bays = Math.max(1, Math.round(length / 8));
        for (let j = 0; j <= bays; j++) {
          box(obj, 0.4, 3.0, 0.32, M.concrete, a[0] + dx * j / bays, base, a[1] + dz * j / bays, ry);
        }
      } else {
        const bays = Math.max(1, Math.round(length / 4.5));
        const pierBase = lecture && (a[0] + b[0]) / 2 < -20 && length > 40 ? 3.4 : base;
        for (let j = 0; j <= bays; j++) {
          const t = j / bays;
          box(obj, 1.3, roof - pierBase - 0.6, 0.32, M.plasterCream,
            a[0] + dx * t, pierBase, a[1] + dz * t, ry);
        }
      }
    }
    if (lecture) {
      // Round lecture-theatre drum remains over mapped solid roof, below the
      // storey-derived maximum (OSM has no measured height). The shallow drum preserves the low campus silhouette.
      const x = 9, z = -1;
      cylinder(obj, 9, 9, 1.18, 48, M.plasterCream, x, roof, z);
      cylinder(obj, 8.8, 8.8, 0.12, 48, M.slate, x, roof + 1.18, z);
      const drum = [];
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        drum.push([x + 9 * Math.cos(angle), z + 9 * Math.sin(angle)]);
      }
      buildColliders(colliders, s, [drum], roof, s.h);
    }
    // Small rooflights are placed only where their whole base fits, away from the open courtyards.
    const solid = (x, z) => inside(ring, x, z) && !holes.some((h) => inside(h, x, z));
    for (const x of [-14, 0, 14]) for (const z of [-16, 8, 26]) {
      if (![-2.2, 2.2].every((dx) => [-1.2, 1.2].every((dz) => solid(x + dx, z + dz)))) continue;
      if (lecture && Math.hypot(x - 9, z + 1) < 14) continue;
      box(obj, 4, 0.35, 2, M.glass, x, roof + 0.05, z);
      box(obj, 4.2, 0.05, 2.2, M.steel, x, roof, z);
      colliders.push({ minX: s.x + x - 2.1, maxX: s.x + x + 2.1,
        minZ: s.z + z - 1.1, maxZ: s.z + z + 1.1, minY: roof, maxY: roof + 0.4 });
    }
    buildColliders(colliders, s, [lower, ...holes], base, lecture ? 3.4 : roof);
    if (lecture) buildColliders(colliders, s, [ring, ...holes], 3.4, roof);
  }
}

export { buildPiotrowoLandmarks };
