import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';
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

function buildPiotrowoLandmarks(ctx) {
  const { group, colliders, M } = ctx;
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
    const base = 0.24, roof = lecture ? 10 : s.h - 0.4;
    const lower = ring.map((p) => p.slice());
    if (lecture) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        if ((a[0] + b[0]) / 2 > -20 || length < 40) continue;
        for (const j of [i, (i + 1) % ring.length]) {
          lower[j][0] += dz / length * 5;
          lower[j][1] -= dx / length * 5;
        }
      }
      slab(obj, lower, holes, base, 4.8 - base, M.facade.glassGreen);
      slab(obj, ring, holes, 4.8, roof - 5.04, M.facade.glassGreen);
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
        const pierBase = lecture && (a[0] + b[0]) / 2 < -20 && length > 40 ? 4.8 : base;
        for (let j = 0; j <= bays; j++) {
          const t = j / bays;
          box(obj, 1.3, roof - pierBase - 0.6, 0.32, M.plasterCream,
            a[0] + dx * t, pierBase, a[1] + dz * t, ry);
        }
      }
    }
    if (lecture) {
      // Historic DSM places the main roof near 10 m and the auditorium/ventilation crown at 17.7 m.
      // The upper drum must contribute to the skyline instead of flattening both into two ordinary storeys.
      const x = 9, z = -1;
      cylinder(obj, 14, 14, s.h - roof - 0.12, 48, M.plasterCream, x, roof, z);
      cylinder(obj, 13.8, 13.8, 0.12, 48, M.slate, x, s.h - 0.12, z);
      const drum = [];
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        drum.push([x + 14 * Math.cos(angle), z + 14 * Math.sin(angle)]);
      }
      buildColliders(colliders, s, [drum], roof, s.h);
    }
    // Small rooflights are placed only where their whole base fits, away from the open courtyards.
    const solid = (x, z) => inside(ring, x, z) && !holes.some((h) => inside(h, x, z));
    for (const x of [-14, 0, 14]) for (const z of [-16, 8, 26]) {
      if (![-2.2, 2.2].every((dx) => [-1.2, 1.2].every((dz) => solid(x + dx, z + dz)))) continue;
      if (lecture && Math.hypot(x - 9, z + 1) < 19) continue;
      box(obj, 4, 0.35, 2, M.glass, x, roof + 0.05, z);
      box(obj, 4.2, 0.05, 2.2, M.steel, x, roof, z);
      colliders.push({ minX: s.x + x - 2.1, maxX: s.x + x + 2.1,
        minZ: s.z + z - 1.1, maxZ: s.z + z + 1.1, minY: roof, maxY: roof + 0.4 });
    }
    buildColliders(colliders, s, [lower, ...holes], base, lecture ? 4.8 : roof);
    if (lecture) buildColliders(colliders, s, [ring, ...holes], 4.8, roof);
  }
  buildCampusMasses(group, colliders, M);
  ctx.piotrowoGrounds = buildCampusGrounds(group, M);
}

// Modest university buildings keep their mapped concave plans. Only the skyline towers and chemistry centre
// receive an explicit facade rhythm; all surfaces reuse already compiled landmark materials.
function buildCampusMasses(group, colliders, M) {
  for (const s of GEO.piotrowo.buildings) {
    const obj = new THREE.Group();
    obj.name = s.name;
    group.add(obj);
    const ring = points(s.ring, { x: 0, z: 0 }), holes = s.holes.map(h => points(h, { x: 0, z: 0 }));
    const tower = s.kind === 'tower', chemistry = s.kind === 'chemistry', tennis = s.kind === 'tennis';
    if (tennis) {
      buildTennisVault(obj, colliders, s, ring, M);
      continue;
    }
    slab(obj, ring, holes, 0.24, s.h - 0.54, chemistry ? M.facade.glassGreen : tower ? M.facade.glassBlue : M.facade.plasterCream);
    slab(obj, ring, holes, s.h - 0.3, 0.3, M.zinc);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 1 || (!tower && !chemistry)) continue;
      const ry = Math.atan2(-dz, dx);
      const floors = tower ? 10 : 4;
      for (let f = 0; f <= floors; f++) {
        box(obj, len, tower ? 0.65 : 0.6, 0.3, tower ? M.concrete : M.plasterCream,
          (a[0] + b[0]) / 2, 0.25 + f * (s.h - 1) / floors, (a[1] + b[1]) / 2, ry);
      }
      const bays = Math.max(1, Math.round(len / (tower ? 2.8 : 5.5)));
      for (let j = 0; j <= bays; j++) {
        box(obj, tower ? 0.32 : 0.7, s.h - 0.55, 0.32, tower ? M.concrete : M.plasterCream,
          a[0] + dx * j / bays, 0.24, a[1] + dz * j / bays, ry);
      }
    }
    if (s.id === 'way/497154324') {
      // The clock on A1's short south-west end is its identifying feature from the riverside campus approach.
      const clock = new THREE.Group();
      clock.position.set(1093.5, 31, 742.9);
      clock.rotation.y = -0.56;
      obj.add(clock);
      const face = new THREE.CylinderGeometry(1.35, 1.35, 0.12, 32);
      face.rotateX(Math.PI / 2);
      addMesh(clock, face, M.plasterWhite, 0, 0, 0);
      box(clock, 0.12, 1.05, 0.16, M.darkMetal, 0, -0.05, 0.09);
      box(clock, 0.85, 0.12, 0.16, M.darkMetal, 0.35, -0.06, 0.09);
      colliders.push({ minX: 1091.8, maxX: 1095.2, minZ: 741.2, maxZ: 744.6, minY: 29.6, maxY: 32.4 });
    }
    buildColliders(colliders, { x: 0, z: 0 }, [ring, ...holes], 0.24, s.h);
  }
}

// The longest mapped edge fixes the hall/court axis, without straightening or enlarging its footprint.
function campusFrame(ring) {
  let length = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > length) { length = d; ux = (b[0] - a[0]) / d; uz = (b[1] - a[1]) / d; }
  }
  const us = ring.map(p => p[0] * ux + p[1] * uz), vs = ring.map(p => -p[0] * uz + p[1] * ux);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  return { ux, uz, u0, u1, v0, v1, length: u1 - u0, width: v1 - v0,
    world: (u, v) => [(u + (u0 + u1) / 2) * ux - (v + (v0 + v1) / 2) * uz,
      (u + (u0 + u1) / 2) * uz + (v + (v0 + v1) / 2) * ux] };
}

function clipCampusRing(ring, distance) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], da = distance(a), db = distance(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push([a[0] + (b[0] - a[0]) * da / (da - db),
      a[1] + (b[1] - a[1]) * da / (da - db)]);
  }
  return out;
}

function buildTennisVault(obj, colliders, s, ring, M) {
  const f = campusFrame(ring), eave = 2.2, base = 0.24, segments = 32;
  const height = v => eave + (s.h - eave) * Math.sqrt(Math.max(0, 1 - (2 * v / f.width) ** 2));
  slab(obj, ring, [], base, eave - base, M.plasterWhite);
  buildColliders(colliders, { x: 0, z: 0 }, [ring], base, eave);
  const positions = [], uv = [];
  const tri = (a, b, c) => {
    const centre = f.world(0, 0);
    const normal = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a)));
    const outward = new THREE.Vector3((a[0] + b[0] + c[0]) / 3 - centre[0],
      (a[1] + b[1] + c[1]) / 3 - eave, (a[2] + b[2] + c[2]) / 3 - centre[1]);
    if (normal.dot(outward) < 0) [b, c] = [c, b];
    positions.push(...a, ...b, ...c);
    for (const p of [a, b, c]) uv.push(p[0], p[2]);
  };
  for (let j = 0; j < segments; j++) {
    const v0 = -f.width / 2 + f.width * j / segments, v1 = v0 + f.width / segments;
    const project = p => -p[0] * f.uz + p[1] * f.ux - (f.v0 + f.v1) / 2;
    const patch = clipCampusRing(clipCampusRing(ring, p => project(p) - v0), p => v1 - project(p));
    if (patch.length < 3) continue;
    const y = p => height(v0) + (height(v1) - height(v0)) * (project(p) - v0) / (v1 - v0);
    const top = patch.map(p => [p[0], y(p), p[1]]);
    for (let k = 1; k + 1 < top.length; k++) {
      const a = top[0], b = top[k], c = top[k + 1];
      if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0) tri(a, b, c);
      else tri(a, c, b);
    }
    // Gables are closed along the actual end outlines; internal strip faces are deliberately omitted.
    for (let k = 0; k < patch.length; k++) {
      const a = patch[k], b = patch[(k + 1) % patch.length];
      if (Math.abs(project(a) - project(b)) < 1e-5) continue;
      const lowA = [a[0], eave, a[1]], lowB = [b[0], eave, b[1]];
      const highA = [a[0], y(a), a[1]], highB = [b[0], y(b), b[1]];
      tri(lowA, highB, highA); tri(lowA, lowB, highB);
    }
    buildColliders(colliders, { x: 0, z: 0 }, [patch], eave, Math.min(height(v0), height(v1)));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  addMesh(obj, geometry, M.plasterWhite);
}

// White paint is geometry at y=.285 (hockey .299): above campus lawn (.26), sidewalk (.22) and park paths (.238).
function campusMarkings(surface, sport = surface.sport.split(';')[0]) {
  const ring = points(surface.ring, { x: 0, z: 0 }), f = campusFrame(ring), lines = [];
  const tennis = sport === 'tennis', beach = sport === 'beachvolleyball';
  const basketball = sport === 'basketball', hockey = sport.includes('field_hockey');
  const length = tennis ? 23.77 : beach ? 16 : basketball ? 28 : hockey ? 91.4 : 105;
  const width = tennis ? 10.97 : beach ? 8 : basketball ? 15 : hockey ? 55 : 68;
  const scale = Math.min(1, (f.length - 3) / length, (f.width - 3) / width);
  const lineWidth = (tennis || beach || basketball ? 0.05 : hockey ? 0.075 : 0.12) * scale;
  const line = (a, b, c, d) => lines.push([a * scale, b * scale, c * scale, d * scale]);
  const rect = (a, b, c, d) => { line(a, b, c, b); line(c, b, c, d); line(c, d, a, d); line(a, d, a, b); };
  const arc = (u, v, r, start = 0, end = Math.PI * 2) => {
    const n = Math.ceil((end - start) * 16);
    for (let i = 0; i < n; i++) {
      const a = start + (end - start) * i / n, b = start + (end - start) * (i + 1) / n;
      line(u + r * Math.cos(a), v + r * Math.sin(a), u + r * Math.cos(b), v + r * Math.sin(b));
    }
  };
  rect(-length / 2, -width / 2, length / 2, width / 2);
  if (tennis) {
    rect(-length / 2, -8.23 / 2, length / 2, 8.23 / 2);
    line(-6.4, -8.23 / 2, -6.4, 8.23 / 2); line(6.4, -8.23 / 2, 6.4, 8.23 / 2);
    line(-6.4, 0, 6.4, 0);
    for (const sign of [-1, 1]) line(sign * length / 2, 0, sign * (length / 2 - 0.1), 0);
  } else if (!beach) {
    line(0, -width / 2, 0, width / 2);
    if (basketball) {
      arc(0, 0, 1.8);
      for (const sign of [-1, 1]) {
        rect(sign * 14, -2.45, sign * 8.2, 2.45);
        arc(sign * 8.2, 0, 1.8);
        // FIBA corner straights meet the 6.75 m arc 0.9 m in from each sideline.
        const a = Math.asin(6.6 / 6.75), basket = sign * 12.425;
        arc(basket, 0, 6.75, sign > 0 ? Math.PI - a : -a, sign > 0 ? Math.PI + a : a);
        const u = basket - sign * Math.sqrt(6.75 ** 2 - 6.6 ** 2);
        line(sign * 14, -6.6, u, -6.6); line(sign * 14, 6.6, u, 6.6);
      }
    } else if (hockey) {
      for (const sign of [-1, 1]) {
        line(sign * (45.7 - 22.9), -27.5, sign * (45.7 - 22.9), 27.5);
        const x = sign * 45.7;
        arc(x, -1.83, 14.63, sign > 0 ? Math.PI : -Math.PI / 2, sign > 0 ? Math.PI * 1.5 : 0);
        arc(x, 1.83, 14.63, sign > 0 ? Math.PI / 2 : 0, sign > 0 ? Math.PI : Math.PI / 2);
        arc(x - sign * 6.4, 0, 0.075);
        line(x - sign * 14.63, -1.83, x - sign * 14.63, 1.83);
      }
    } else {
      arc(0, 0, 9.15);
      arc(0, 0, 0.1);
      for (const sign of [-1, 1]) {
        rect(sign * 52.5, -20.16, sign * (52.5 - 16.5), 20.16);
        rect(sign * 52.5, -9.16, sign * (52.5 - 5.5), 9.16);
        arc(sign * (52.5 - 11), 0, 0.1);
        // Penalty arc is only the portion outside the penalty area.
        const a = Math.acos(5.5 / 9.15);
        arc(sign * (52.5 - 11), 0, 9.15, sign > 0 ? Math.PI - a : -a, sign > 0 ? Math.PI + a : a);
      }
    }
  }
  return { f, scale, length: length * scale, width: width * scale, lineWidth, lines };
}

function buildCampusGrounds(group, M) {
  const obj = new THREE.Group();
  obj.name = 'Piotrowo nawierzchnie';
  group.add(obj);
  const material = { artificial_turf: M.hedge, carpet: M.hedge, rubber: M.brick, sand: M.sandstone, clay: M.tileRed };
  for (const s of GEO.piotrowo.grounds) {
    if (s.kind !== 'pitch') continue;
    slab(obj, points(s.ring, { x: 0, z: 0 }), [], 0.22, 0.055, material[s.surface] || M.granite);
    for (const sport of s.sport.split(';')) {
      const marks = campusMarkings(s, sport);
      for (const [u0, v0, u1, v1] of marks.lines) {
        const a = marks.f.world(u0, v0), b = marks.f.world(u1, v1);
        box(obj, Math.hypot(b[0] - a[0], b[1] - a[1]), 0.008, marks.lineWidth, sport === 'field_hockey' ? M.plasterOchre : M.plasterWhite,
          (a[0] + b[0]) / 2, sport === 'field_hockey' ? 0.299 : 0.285, (a[1] + b[1]) / 2, Math.atan2(a[1] - b[1], b[0] - a[0]));
      }
    }
  }
  const forecourt = campusForecourt();
  const circle = r => Array.from({ length: 96 }, (_, i) => [forecourt.x + Math.cos(i * Math.PI / 48) * r,
    forecourt.z + Math.sin(i * Math.PI / 48) * r]);
  // Photo ratios against the mapped 20.4 m walkway: central lawn 13.5 m, outer paving 28.3 m.
  // Coping is shallow and walkable; no unsupported furniture, retaining walls or raised terraces.
  slab(obj, circle(28.3), [circle(13.5)], 0.22, 0.055, M.concrete);
  slab(obj, circle(13.5), [], 0.22, 0.055, M.hedge);
  for (const [outer, inner, mat, y] of [[14, 13.5, M.sandstone, 0.285], [23, 22.4, M.granite, 0.28],
    [28.3, 28, M.sandstone, 0.28]]) slab(obj, circle(outer), [circle(inner)], y, 0.015, mat);
  // Pale slab joints on a regular grid distinguish the forecourt from the surrounding walks.
  for (let x = -28; x <= 28; x += 2) {
    const z = Math.sqrt(Math.max(0, 28 ** 2 - x ** 2));
    const gap = Math.abs(x) < 14 ? Math.sqrt(14 ** 2 - x ** 2) : 0;
    for (const sign of [-1, 1]) {
      if (z <= gap) continue;
      box(obj, 0.025, 0.005, z - gap, M.stoneGrey, forecourt.x + x, 0.278,
        forecourt.z + sign * (z + gap) / 2);
      box(obj, z - gap, 0.005, 0.025, M.stoneGrey, forecourt.x + sign * (z + gap) / 2, 0.278,
        forecourt.z + x);
    }
  }
  obj.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  return obj;
}

function campusForecourt() {
  const ring = points(GEO.piotrowo.forecourt.ring, { x: 0, z: 0 });
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
    radius: (Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs)) / 4 };
}

export { buildPiotrowoLandmarks, campusFrame, campusMarkings, campusForecourt };
