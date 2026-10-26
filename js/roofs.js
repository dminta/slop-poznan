import * as THREE from 'three/webgpu';

// js/roofs.js
// Pitched roofs for the generic buildings (buildings.js commit()): gable, hip, mansard and gambrel (łamany) roofs in
// red tile, grey slate/sheet metal and copper patina. Static skyline geometry, built once and never streamed: the
// meshes live under the CityBlocks root, so scene culling chunks them like any other static instanced family.
//
// Every roof is one to three instances of four unit pieces (base at y = 0, rise to y = 1, ridge along local x):
//   - PRISM: the gable profile extruded along x in [-0.5, 0.5], gable triangles closing both ends (6 triangles);
//   - HIP_CAP: the end of a hip roof, x in [0, 1] from the end of the ridge out to the eave (3 triangles);
//   - GAMBREL: the mansard profile (steep lower band, shallow top) extruded, pentagon ends (14 triangles);
//   - MANSARD_CAP: the mansard end, like HIP_CAP (9 triangles).
// A gable roof is one PRISM and a gambrel one GAMBREL, both stretched to w × d. Hip and mansard roofs are a prism over
// the middle w − d of the ridge plus a cap of d/2 × d at each end. The caps scale with d alone, so every slope keeps
// the same pitch on long and square plans alike (a stretched unit hip would have steeper ends on long buildings),
// and a square plan is just the two caps (a pyramid / pavilion roof). Inside a hip the prism's gable triangles lie
// on the caps' inner faces, hidden.
//
// Roofs are staged as records (x, y, z, sx, sy, sz, ry, piece) and turned into instance matrices once, in finish(),
// so a turned frontage frame can still move the instances it added (transform) after its lots are populated, and
// each mesh's instanceMatrix ends up exactly as long as its count (scene culling skips meshes with spare capacity).

const RISE_MANSARD = 0.72; // height of the mansard's knee (break between the steep and shallow slopes), of the rise
const BAND_MANSARD = 0.28; // depth of the steep band, of the half-depth (d/2)

// Builds a flat-shaded, non-indexed geometry from convex polygons; each polygon is wound to face away from `inside`
// (a point inside the convex piece), so the normals are right whatever order the corners are listed in.
function buildPiece(polys, inside) {
  const pos = [];
  const nrm = [];
  const uvs = [];
  for (const { pts, uv } of polys) {
    // Newell normal of the polygon
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0] / pts.length;
      cy += a[1] / pts.length;
      cz += a[2] / pts.length;
    }
    let order = pts.map((_, i) => i);
    if (nx * (cx - inside[0]) + ny * (cy - inside[1]) + nz * (cz - inside[2]) < 0) {
      order = order.reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz);
    for (let i = 1; i + 1 < order.length; i++) {
      for (const k of [order[0], order[i], order[i + 1]]) {
        pos.push(pts[k][0], pts[k][1], pts[k][2]);
        nrm.push(nx / len, ny / len, nz / len);
        uvs.push(uv[k][0], uv[k][1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

// Roof profile across the depth: [z, y] from the north eave (z = -0.5) over the ridge to the south eave (z = 0.5)
function profile(mansard) {
  if (!mansard) return [[-0.5, 0], [0, 1], [0.5, 0]];
  const kz = 0.5 - BAND_MANSARD * 0.5;
  return [[-0.5, 0], [-kz, RISE_MANSARD], [0, 1], [kz, RISE_MANSARD], [0.5, 0]];
}

// Profile extruded along x in [-0.5, 0.5], closed with gable ends. uv: slopes run u along the ridge and v from the
// eave (0) up to the ridge (1); gable ends u across the depth and v up the rise
function prismPiece(mansard) {
  const prof = profile(mansard);
  const polys = [];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [z0, y0] = prof[i];
    const [z1, y1] = prof[i + 1];
    polys.push({
      pts: [[-0.5, y0, z0], [0.5, y0, z0], [0.5, y1, z1], [-0.5, y1, z1]],
      uv: [[0, y0], [1, y0], [1, y1], [0, y1]]
    });
  }
  for (const x of [-0.5, 0.5]) {
    polys.push({ pts: prof.map(([z, y]) => [x, y, z]), uv: prof.map(([z, y]) => [z + 0.5, y]) });
  }
  return buildPiece(polys, [0, 0.2, 0]);
}

// Hip / mansard end, x in [0, 1] (scaled to d/2) from the end of the ridge out to the eave, z in [-0.5, 0.5] (scaled
// to d). Its height is the profile of the distance to the nearest eave, measured in half-depths on both axes
// (1 − x to the end eave, 1 − 2|z| to the side eaves), so the end slope matches the side slopes; the facets meet
// on the mitres x = 2|z|. uv: u along the eave, v up the slope as on the prism
function capPiece(mansard) {
  const polys = [];
  if (!mansard) {
    polys.push({ pts: [[1, 0, -0.5], [1, 0, 0.5], [0, 1, 0]], uv: [[0, 0], [1, 0], [0.5, 1]] });
    for (const s of [-1, 1]) {
      polys.push({ pts: [[0, 0, 0.5 * s], [1, 0, 0.5 * s], [0, 1, 0]], uv: [[0, 0], [1, 0], [0, 1]] });
    }
    return buildPiece(polys, [0.4, 0.15, 0]);
  }
  const b = BAND_MANSARD;
  const k = RISE_MANSARD;
  const kz = (1 - b) * 0.5; // the knee line's |z| on the sides, and its x on the end is 1 − b
  // end: steep trapezoid, then the shallow triangle up to the ridge end
  polys.push({
    pts: [[1, 0, -0.5], [1, 0, 0.5], [1 - b, k, kz], [1 - b, k, -kz]],
    uv: [[0, 0], [1, 0], [0.5 + kz, k], [0.5 - kz, k]]
  });
  polys.push({ pts: [[1 - b, k, -kz], [1 - b, k, kz], [0, 1, 0]], uv: [[0.5 - kz, k], [0.5 + kz, k], [0.5, 1]] });
  for (const s of [-1, 1]) {
    polys.push({
      pts: [[0, 0, 0.5 * s], [1, 0, 0.5 * s], [1 - b, k, kz * s], [0, k, kz * s]],
      uv: [[0, 0], [1, 0], [1 - b, k], [0, k]]
    });
    polys.push({ pts: [[0, k, kz * s], [1 - b, k, kz * s], [0, 1, 0]], uv: [[0, k], [1 - b, k], [0, 1]] });
  }
  return buildPiece(polys, [0.4, 0.15, 0]);
}

const PIECES = ['prism', 'hipCap', 'gambrel', 'mansardCap'];
const ROOF_SHAPES = ['gable', 'hip', 'mansard', 'gambrel'];
const ROOF_MATERIALS = ['tile', 'slate', 'copper'];
// Fallbacks when the caller has no material for a key: red ceramic tile, dark slate / sheet metal, copper patina
const FALLBACK_COLORS = { tile: 0xa34a30, slate: 0x4b5159, copper: 0x5e9c86 };
// buildCityBlocks commits about 12,000 buildings over the Poznań blocks, 9,240 of them with pitched roofs that take
// 21,200 instance records (a hip or mansard takes 3), so 32k records leave ~50% headroom (1 MB)
const MAX_ROOF_INSTANCES = 32000;
const STRIDE = 8; // x, y, z, sx, sy, sz, ry, mesh index

function createRoofGeometries() {
  return { prism: prismPiece(false), hipCap: capPiece(false), gambrel: prismPiece(true), mansardCap: capPiece(true) };
}

// createRoofs({ materials: { tile, slate, copper }, max, parent }) → the roof family. Meshes exist from the start (one
// per piece × material, added to `parent` if given) so the build can register them; they get their instances in
// finish(). Call order: add()… (mark() / transform() per turned block) …, then finish() once, before scene culling
function createRoofs({ materials = {}, max = MAX_ROOF_INSTANCES, parent = null } = {}) {
  const geos = createRoofGeometries();
  const mats = {};
  for (const key of ROOF_MATERIALS) {
    mats[key] = materials[key] || new THREE.MeshStandardNodeMaterial({ color: FALLBACK_COLORS[key], roughness: 0.8 });
  }
  const meshes = [];
  const meshIndex = {}; // `${piece}:${material}` -> index into meshes
  for (const key of ROOF_MATERIALS) {
    for (const piece of PIECES) {
      // capacity 1 until finish() hands it an exact-size instanceMatrix
      const mesh = new THREE.InstancedMesh(geos[piece], mats[key], 1);
      mesh.name = `Roof-${piece}-${key}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshIndex[`${piece}:${key}`] = meshes.length;
      meshes.push(mesh);
      if (parent) parent.add(mesh);
    }
  }

  const rec = new Float32Array(max * STRIDE);
  let n = 0;
  let finished = false;

  function push(mi, x, y, z, sx, sy, sz, ry) {
    const o = n++ * STRIDE;
    rec[o] = x;
    rec[o + 1] = y;
    rec[o + 2] = z;
    rec[o + 3] = sx;
    rec[o + 4] = sy;
    rec[o + 5] = sz;
    rec[o + 6] = ry;
    rec[o + 7] = mi;
  }

  // Roof of shape ('gable' | 'hip' | 'mansard' | 'gambrel') and material ('tile' | 'slate' | 'copper') on the plan
  // w × d centred on (x, z) at eave height y, rising h, turned ry about y. w runs along local x, so a gable or gambrel
  // ridge runs along w; hip and mansard ridges always run along the longer side. Returns false (adding nothing) when
  // the shape or material is unknown, the size degenerate, the pool full or the family already finished
  function add(shape, mat, x, y, z, w, d, h, ry = 0) {
    if (finished || !(w > 0 && d > 0 && h > 0) || !mats[mat]) return false;
    if (shape === 'gable' || shape === 'gambrel') {
      if (n + 1 > max) return false;
      push(meshIndex[`${shape === 'gable' ? 'prism' : 'gambrel'}:${mat}`], x, y, z, w, h, d, ry);
      return true;
    }
    if (shape !== 'hip' && shape !== 'mansard') return false;
    if (d > w) {
      const t = w;
      w = d;
      d = t;
      ry += Math.PI * 0.5;
    }
    const mid = w - d;
    const pieces = mid > 1e-3 ? 3 : 2;
    if (n + pieces > max) return false;
    const mansard = shape === 'mansard';
    const cap = meshIndex[`${mansard ? 'mansardCap' : 'hipCap'}:${mat}`];
    if (pieces === 3) push(meshIndex[`${mansard ? 'gambrel' : 'prism'}:${mat}`], x, y, z, mid, h, d, ry);
    // caps at both ends of the ridge, the far one turned half a turn so its x still runs out to the eave
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const off = mid * 0.5;
    push(cap, x + c * off, y, z - s * off, d * 0.5, h, d, ry);
    push(cap, x - c * off, y, z + s * off, d * 0.5, h, d, ry + Math.PI);
    return true;
  }

  // Number of instances staged so far; take it before populating a turned block and pass it to transform() after
  function mark() {
    return n;
  }

  // Moves the instances added since `from` out of a frontage frame: positions through toWorld(x, z) → [x, z] (the
  // frame's rigid turn, see buildings.js placeInFrame) and their yaw on by the frame's turn th
  function transform(from, toWorld, th) {
    for (let i = from; i < n; i++) {
      const o = i * STRIDE;
      const [wx, wz] = toWorld(rec[o], rec[o + 2]);
      rec[o] = wx;
      rec[o + 2] = wz;
      rec[o + 6] += th;
    }
  }

  // Writes every staged record into its mesh: an instanceMatrix exactly `count` long, bounds for culling. Meshes
  // that got no roofs are hidden. Call once, after the last add and before scene culling sees the meshes
  function finish() {
    if (finished) return;
    finished = true;
    const counts = new Int32Array(meshes.length);
    for (let i = 0; i < n; i++) counts[rec[i * STRIDE + 7]]++;
    const arrays = meshes.map((_, k) => new Float32Array(Math.max(1, counts[k]) * 16));
    const fill = new Int32Array(meshes.length);
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const k = rec[o + 7];
      const e = arrays[k];
      const m = fill[k]++ * 16;
      const c = Math.cos(rec[o + 6]);
      const s = Math.sin(rec[o + 6]);
      const sx = rec[o + 3], sy = rec[o + 4], sz = rec[o + 5];
      // T · Ry · S, column-major
      e[m] = c * sx;
      e[m + 2] = -s * sx;
      e[m + 5] = sy;
      e[m + 8] = s * sz;
      e[m + 10] = c * sz;
      e[m + 12] = rec[o];
      e[m + 13] = rec[o + 1];
      e[m + 14] = rec[o + 2];
      e[m + 15] = 1;
    }
    meshes.forEach((mesh, k) => {
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(arrays[k], 16);
      mesh.count = counts[k];
      if (!counts[k]) {
        mesh.visible = false;
        return;
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    });
  }

  return { meshes, add, mark, transform, finish, count: () => n };
}

export { createRoofs, createRoofGeometries, ROOF_SHAPES, ROOF_MATERIALS, MAX_ROOF_INSTANCES };
