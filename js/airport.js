import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';
import { createCurtainWallMaterial } from './tsl-materials.js';

// js/airport.js
// Port Lotniczy Poznań-Ławica (GEO.aeroway): the 10/28 runway, its markings and lights, the taxiway network, the
// aprons and the passenger terminals. The aerodrome is cut out of the block raster (tools/poz-blocks.mjs), so this
// module is the only thing that draws the 2.81 km² airfield. Everything is static, merged into a handful of meshes:
// two tarmac surfaces, white/yellow paint, four instanced light colours, terminal walls/roofs and jet bridges.
//
// The runway is a 2,492 × 50 m rectangle at 107.5°; its frame is derived from the OSM outline (principal axis), so a
// future runway change needs no constant. Markings follow the real layout: centreline dashes, threshold piano keys,
// aiming-point and touchdown-zone bars, and the 10/28 designations built as seven-segment bars (no texture).
// Taxiway centrelines are yellow, edge lights blue; runway edge lights white, thresholds green, end lights red, PAPI
// and approach lights red/white.

const SURFACE_Y = 0.035; // above the land deck at y = 0
const MARK_Y = 0.055; // paint above the tarmac
const LIGHT_Y = 0.38;
const RUNWAY_EDGE_STEP = 60;
const TAXIWAY_EDGE_STEP = 30;
const APPROACH_STEP = 30;

const TARMAC = 0x3d4041;
const CONCRETE = 0x6b6d6b;
const WHITE_PAINT = 0xf1f0e7;
const YELLOW_PAINT = 0xd7ad3d;
const GLASS = { glassTint: 0x1b3347, frameTint: 0x6c7377, windowWidth: 4.2, floorHeight: 4.2, spandrelRatio: 0.24, litProbability: 0.22, reflectivity: 0.8 };

const ringPts = (flat) => {
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
};
const ringArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a * 0.5;
};

// Oriented frame of a (roughly rectangular) OSM outline: centroid, long axis u, across axis v, length and width.
// The principal axis of the point cloud gives the runway/taxiway/apron direction without a hard-coded bearing.
function frameOf(pts) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length;
  cz /= pts.length;
  let cxx = 0, cxz = 0, czz = 0;
  for (const [x, z] of pts) {
    const dx = x - cx, dz = z - cz;
    cxx += dx * dx;
    cxz += dx * dz;
    czz += dz * dz;
  }
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  let ux = Math.cos(theta), uz = Math.sin(theta);
  let vx = -uz, vz = ux;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, z] of pts) {
    const dx = x - cx, dz = z - cz;
    const u = dx * ux + dz * uz, v = dx * vx + dz * vz;
    if (u < umin) umin = u;
    if (u > umax) umax = u;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  const uMid = (umin + umax) * 0.5, vMid = (vmin + vmax) * 0.5;
  const ox = cx + ux * uMid + vx * vMid, oz = cz + uz * uMid + vz * vMid;
  return { cx: ox, cz: oz, ux, uz, vx, vz, length: umax - umin, width: vmax - vmin };
}
const pointInFrame = (f, s, t) => [f.cx + f.ux * t + f.vx * s, f.cz + f.uz * t + f.vz * s];

function addQuad(acc, a, b, c, d, y) {
  const base = acc.pos.length / 3;
  for (const [x, z] of [a, b, c, d]) acc.pos.push(x, y, z);
  // (b - a) × (c - a) points up when the 2D cross is negative in (x, z)
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function addRectFrame(acc, f, s0, s1, t0, t1, y) {
  const a = pointInFrame(f, s0, t0), b = pointInFrame(f, s1, t0);
  const c = pointInFrame(f, s1, t1), d = pointInFrame(f, s0, t1);
  addQuad(acc, a, b, c, d, y);
}
function addPolygon(acc, pts, y) {
  if (pts.length < 3) return;
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!faces.length) return;
  const base = acc.pos.length / 3;
  for (const [x, z] of pts) acc.pos.push(x, y, z);
  for (const [a, b, c] of faces) {
    const cross = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    if (cross > 0) acc.idx.push(base + a, base + c, base + b);
    else acc.idx.push(base + a, base + b, base + c);
  }
}
// Walls of an extruded outline: outward-facing quads between y0 and y1, winding chosen from the centroid.
function addWalls(acc, pts, y0, y1, cx, cz) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const mx = (a[0] + b[0]) * 0.5, mz = (a[1] + b[1]) * 0.5;
    const outward = -dz * (mx - cx) + dx * (mz - cz) >= 0;
    const base = acc.pos.length / 3;
    const v = [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]];
    for (const p of v) acc.pos.push(p[0], p[1], p[2]);
    if (outward) acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

// Seven-segment digits, in metres, centred on the digit. Runway numbers are 18 m high and 12 m wide.
const DIGIT_H = 18, DIGIT_W = 12, DIGIT_STROKE = 1.8;
const SEG = (() => {
  const w = DIGIT_W / 2, h = DIGIT_H / 2, s = DIGIT_STROKE;
  return {
    a: [-w, w, h - s, h], b: [w - s, w, 0, h], c: [w - s, w, -h, 0], d: [-w, w, -h, -h + s],
    e: [-w, -w + s, -h, 0], f: [-w, -w + s, 0, h], g: [-w, w, -s / 2, s / 2]
  };
})();
const DIGITS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgecd', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
};
function addDigit(acc, f, centerS, centerT, readSign, upSign, digit) {
  for (const seg of DIGITS[digit] || '') {
    const [s0, s1, t0, t1] = SEG[seg];
    addRectFrame(acc, f,
      centerS + readSign * s0, centerS + readSign * s1,
      centerT + upSign * t0, centerT + upSign * t1, MARK_Y);
  }
}

// The 10/28 designation, two digits side by side, upright for a pilot approaching from that threshold.
function addRunwayNumber(acc, f, t, readSign, upSign, text) {
  const gap = 2, step = DIGIT_W + gap;
  for (let i = 0; i < text.length; i++) {
    const s = readSign * ((i - (text.length - 1) / 2) * step);
    addDigit(acc, f, s, t, readSign, upSign, text[i]);
  }
}

function addRunwayMarkings(mark, lights, f) {
  const L = f.length, W = f.width;
  const end = L * 0.5;
  // Centreline: 30 m dashes with 20 m gaps, 0.9 m wide.
  for (let t = -end + 60; t + 30 < end - 60; t += 50) addRectFrame(mark, f, -0.45, 0.45, t, t + 30, MARK_Y);
  for (const s of [-1, 1]) {
    // Threshold piano keys: eight 30 m bars, 1.8 m wide, 3.6 m pitch, 2 m inside the threshold.
    for (let k = 0; k < 8; k++) {
      const v = (k - 3.5) * 3.6;
      addRectFrame(mark, f, v - 0.9, v + 0.9, s * (end - 2), s * (end - 32), MARK_Y);
    }
    // Aiming point: two 45 × 6 m bars, 300 m from the threshold.
    for (const v of [-8.5, 8.5]) {
      addRectFrame(mark, f, v - 3, v + 3, s * (end - 277.5), s * (end - 322.5), MARK_Y);
    }
    // Touchdown zone: pairs of 22.5 × 3 m bars at 150, 450 and 600 m, 8.5 m from the centreline.
    for (const d of [150, 450, 600]) {
      for (const v of [-8.5, 8.5]) addRectFrame(mark, f, v - 1.5, v + 1.5, s * (end - d - 11.25), s * (end - d + 11.25), MARK_Y);
    }
    // Designation: 10 at the west threshold, 28 at the east one; the number is upright for the approach.
    addRunwayNumber(mark, f, s * (end - 75), -s, -s, s < 0 ? '10' : '28');
    // Threshold lights: green facing the approach, red at the departure end.
    for (let k = 0; k < 8; k++) {
      const v = -W * 0.5 + 2 + (k * (W - 4)) / 7;
      const [x, z] = pointInFrame(f, v, s * (end - 1));
      lights.green.push(x, z);
      const [rx, rz] = pointInFrame(f, v, s * (end - 2.6));
      lights.red.push(rx, rz);
    }
  }
  // Runway edge lights, white, every 60 m on both sides.
  for (const s of [-1, 1]) {
    const v = s * (W * 0.5 - 1.2);
    for (let t = -end + 30; t <= end - 30; t += RUNWAY_EDGE_STEP) {
      const [x, z] = pointInFrame(f, v, t);
      lights.white.push(x, z);
    }
  }
  // PAPI: four units 300 m from each threshold, on the left of the approach (white near, red far).
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const v = s * (W * 0.5 + 18 + i * 4);
      const [x, z] = pointInFrame(f, v, s * (end - 300));
      (i < 2 ? lights.white : lights.red).push(x, z);
    }
  }
  // Approach lighting: a line of white lights on the extended centreline, 30–240 m beyond each threshold.
  for (const s of [-1, 1]) {
    for (let i = 1; i <= 8; i++) {
      const [x, z] = pointInFrame(f, 0, s * (end + i * APPROACH_STEP));
      lights.white.push(x, z);
    }
  }
}

// Unit normals of a polyline at every vertex (averaged at a bend).
function lineNormals(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const [px, pz] = line[Math.max(0, i - 1)];
    const [nx, nz] = line[Math.min(line.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    out.push([-dz / len, dx / len]);
  }
  return out;
}
const lineLength = (line) => {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return total;
};
// A thin ribbon along a polyline (taxiway centrelines, which follow the OSM curve rather than the OBB).
function addLineRibbon(acc, line, width, y) {
  const n = lineNormals(line);
  const half = width * 0.5;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], na = n[i], nb = n[i + 1];
    addQuad(acc,
      [a[0] + na[0] * half, a[1] + na[1] * half], [b[0] + nb[0] * half, b[1] + nb[1] * half],
      [b[0] - nb[0] * half, b[1] - nb[1] * half], [a[0] - na[0] * half, a[1] - na[1] * half], y);
  }
}
function addTaxiwayMarkings(mark, lights, f, line, width) {
  if (line && line.length >= 2) {
    addLineRibbon(mark, line, 0.3, MARK_Y);
    // Blue edge lights along both sides, every 30 m of the real centreline.
    const n = lineNormals(line);
    const half = Math.max(0.5, width * 0.5 - 0.5);
    let next = TAXIWAY_EDGE_STEP;
    let total = 0;
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i];
      const len = Math.hypot(bx - ax, bz - az) || 1e-9;
      while (next <= total + len) {
        const t = (next - total) / len;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const nx = n[i - 1][0] + (n[i][0] - n[i - 1][0]) * t;
        const nz = n[i - 1][1] + (n[i][1] - n[i - 1][1]) * t;
        lights.blue.push(x + nx * half, z + nz * half, x - nx * half, z - nz * half);
        next += TAXIWAY_EDGE_STEP;
      }
      total += len;
    }
    return;
  }
  if (f.length < 8 || f.width < 1.5) return;
  addRectFrame(mark, f, -0.15, 0.15, -f.length * 0.5 + 1, f.length * 0.5 - 1, MARK_Y);
  const n = Math.min(16, Math.max(1, Math.floor((f.length - 8) / TAXIWAY_EDGE_STEP)));
  for (const s of [-1, 1]) {
    const v = s * (f.width * 0.5 - 0.5);
    for (let i = 0; i <= n; i++) {
      const t = -f.length * 0.5 + 4 + (i * (f.length - 8)) / Math.max(1, n);
      const [x, z] = pointInFrame(f, v, t);
      lights.blue.push(x, z);
    }
  }
}

function addApronMarkings(mark, f) {
  if (f.length < 20) return;
  addRectFrame(mark, f, -0.15, 0.15, -f.length * 0.5 + 2, f.length * 0.5 - 2, MARK_Y);
}

function addHelipadMarkings(mark, f) {
  const r = Math.min(f.width, f.length) * 0.32;
  if (r < 3) return;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    addQuad(mark,
      pointInFrame(f, Math.cos(a0) * r, Math.sin(a0) * r), pointInFrame(f, Math.cos(a1) * r, Math.sin(a1) * r),
      pointInFrame(f, Math.cos(a1) * (r + 0.45), Math.sin(a1) * (r + 0.45)), pointInFrame(f, Math.cos(a0) * (r + 0.45), Math.sin(a0) * (r + 0.45)), MARK_Y);
  }
  addRectFrame(mark, f, -2.2, -1.6, -3.2, 3.2, MARK_Y);
  addRectFrame(mark, f, 1.6, 2.2, -3.2, 3.2, MARK_Y);
  addRectFrame(mark, f, -1.6, 1.6, -0.3, 0.3, MARK_Y);
}

function buildGeometry(acc) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  geo.setIndex(acc.idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function lightMesh(positions, color) {
  if (!positions.length) return null;
  const geo = new THREE.OctahedronGeometry(0.34, 0);
  const mat = new THREE.MeshBasicNodeMaterial({ color });
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length / 2);
  mesh.name = `AirportLights${color.toString(16)}`;
  const m = new THREE.Matrix4();
  for (let i = 0; i < positions.length; i += 2) {
    m.makeTranslation(positions[i], LIGHT_Y, positions[i + 1]);
    mesh.setMatrixAt(i / 2, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Build the Ławica airport from GEO.aeroway.
 * @param {import('three/webgpu').Scene} scene
 * @returns {{ group: THREE.Group, count: number }}
 */
function buildAirport(scene) {
  const group = new THREE.Group();
  group.name = 'Airport';
  const list = GEO.aeroway || [];
  if (!list.length) {
    scene.add(group);
    return { group, colliders: [], count: 0 };
  }

  const concrete = { pos: [], idx: [] };
  const tarmac = { pos: [], idx: [] };
  const white = { pos: [], idx: [] };
  const yellow = { pos: [], idx: [] };
  const walls = { pos: [], idx: [] };
  const roofs = { pos: [], idx: [] };
  const lights = { white: [], green: [], red: [], blue: [] };
  const bridges = [];
  const colliders = [];

  for (const a of list) {
    const pts = ringPts(a.ring);
    if (pts.length < 3) continue;
    const f = frameOf(pts);
    if (a.kind === 'runway') {
      addPolygon(concrete, pts, SURFACE_Y);
      addRunwayMarkings(white, lights, f);
    } else if (a.kind === 'taxiway') {
      addPolygon(tarmac, pts, SURFACE_Y);
      const line = a.line ? ringPts(a.line) : null;
      const len = line ? lineLength(line) : 0;
      const width = len > 0 ? Math.abs(ringArea(pts)) / len : f.width;
      addTaxiwayMarkings(yellow, lights, f, line, width);
    } else if (a.kind === 'apron') {
      addPolygon(tarmac, pts, SURFACE_Y);
      addApronMarkings(yellow, f);
    } else if (a.kind === 'helipad') {
      addPolygon(tarmac, pts, SURFACE_Y);
      addHelipadMarkings(white, f);
    } else if (a.kind === 'terminal') {
      const h = a.h || 8;
      addWalls(walls, pts, 0, h, f.cx, f.cz);
      addPolygon(roofs, pts, h);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of pts) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      // The terminal walls are solid: keep the player and the street actors out of the building.
      colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY: h });
      // Passenger boarding bridges: the low wide passenger terminals get tubes reaching the apron.
      const area = Math.abs(ringArea(pts));
      if (area > 3000) {
        // The aprons lie north of the passenger terminals (more negative z), so the bridges leave the north facade.
        const n = Math.max(2, Math.min(5, Math.round((x1 - x0) / 45)));
        for (let i = 0; i < n; i++) {
          const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
          bridges.push({ x, z: z0 - 13, w: 3.2, h: 3.6, d: 26, y: 4.4 });
          addRectFrame(yellow, { cx: x, cz: z0, ux: 0, uz: -1, vx: 1, vz: 0 }, -0.2, 0.2, 26, 54, MARK_Y);
        }
      }
    }
  }

  const surfaceMat = new THREE.MeshStandardNodeMaterial({ color: CONCRETE, roughness: 0.9, metalness: 0.03 });
  const tarmacMat = new THREE.MeshStandardNodeMaterial({ color: TARMAC, roughness: 0.94, metalness: 0.02 });
  const whiteMat = new THREE.MeshStandardNodeMaterial({ color: WHITE_PAINT, roughness: 0.86, metalness: 0.0 });
  const yellowMat = new THREE.MeshStandardNodeMaterial({ color: YELLOW_PAINT, roughness: 0.86, metalness: 0.0 });
  const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0x9ba1a3, roughness: 0.7, metalness: 0.18 });
  const glassMat = createCurtainWallMaterial(GLASS);
  const bridgeMat = new THREE.MeshStandardNodeMaterial({ color: 0xb6bcc0, roughness: 0.55, metalness: 0.28 });

  const addMesh = (acc, mat, name, shadows = false) => {
    if (!acc.idx.length) return;
    const mesh = new THREE.Mesh(buildGeometry(acc), mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  };
  addMesh(concrete, surfaceMat, 'AirportRunway');
  addMesh(tarmac, tarmacMat, 'AirportTarmac');
  addMesh(white, whiteMat, 'AirportMarkingsWhite');
  addMesh(yellow, yellowMat, 'AirportMarkingsYellow');
  addMesh(walls, glassMat, 'AirportTerminalWalls', true);
  addMesh(roofs, roofMat, 'AirportTerminalRoofs', true);

  for (const [name, color] of [['white', 0xfff4d6], ['green', 0x4dff6a], ['red', 0xff3b30], ['blue', 0x3d8bff]]) {
    const mesh = lightMesh(lights[name], color);
    if (mesh) group.add(mesh);
  }

  if (bridges.length) {
    const tube = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bridgeMat, bridges.length);
    const column = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bridgeMat, bridges.length);
    tube.name = 'AirportJetBridges';
    column.name = 'AirportJetBridgeColumns';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    bridges.forEach((b, i) => {
      m.compose(p.set(b.x, b.y, b.z), q.identity(), s.set(b.w, b.h, b.d));
      tube.setMatrixAt(i, m);
      m.compose(p.set(b.x, 2.2, b.z + b.d * 0.5 - 1), q.identity(), s.set(0.55, 4.4, 0.55));
      column.setMatrixAt(i, m);
    });
    tube.instanceMatrix.needsUpdate = true;
    column.instanceMatrix.needsUpdate = true;
    tube.castShadow = column.castShadow = true;
    tube.receiveShadow = column.receiveShadow = true;
    group.add(tube, column);
  }

  scene.add(group);
  return { group, colliders, count: list.length };
}

export { buildAirport };
