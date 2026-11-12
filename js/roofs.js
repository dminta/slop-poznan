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
// (a point inside the convex piece), or along its own `n` when it has one (non-convex pieces: the gable screens), so
// the normals are right whatever order the corners are listed in.
function buildPiece(polys, inside) {
  const pos = [];
  const nrm = [];
  const uvs = [];
  for (const { pts, uv, n } of polys) {
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
    const out = n ? nx * n[0] + ny * n[1] + nz * n[2]
      : nx * (cx - inside[0]) + ny * (cy - inside[1]) + nz * (cz - inside[2]);
    if (out < 0) {
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

// -------------------------------------------------------------------------------------------------------------------
// Dormers (lukarny): a gabled box standing on a roof slope, its front wall facing down the slope. Unit piece: the front
// wall at z = 0 (x in [-0.5, 0.5], y from 0 to 1), cheeks running back to z = -1 into the roof (the back and the
// underside stay buried, so they are left out) and its own small gable roof rising DORMER_ROOF over the front wall,
// the ridge running back into the main roof. Scaled to (width, front wall height, depth); 11 triangles. The front and
// the cheeks are vertical, so createRoofMaterial renders them as gable-end render and lays the covering on the top.
// The window is a separate unit quad (DORMER_WINDOW, its own material) set on the front wall.
// -------------------------------------------------------------------------------------------------------------------
const DORMER_ROOF = 0.45; // the dormer's own roof rise, of its front wall height
const DORMER_MATERIALS = ['tile', 'slate']; // no dormers on copper (turret helms, risalits)

function dormerPiece() {
  const r = 1 + DORMER_ROOF;
  const polys = [
    { pts: [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [0, r, 0], [-0.5, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0.5, r], [0, 1]] }
  ];
  for (const s of [-1, 1]) {
    const x = 0.5 * s;
    polys.push({ pts: [[x, 0, 0], [x, 0, -1], [x, 1, -1], [x, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    polys.push({ pts: [[x, 1, 0], [x, 1, -1], [0, r, -1], [0, r, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  }
  return buildPiece(polys, [0, 0.6, -0.5]);
}

// Unit window pane facing +z: x in [-0.5, 0.5], y from 0 to 1 (uv across it, for the frame and mullions)
function windowPiece() {
  return buildPiece([{ pts: [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }], [0, 0.5, -1]);
}

// Height of a roof's slope over its eave at horizontal distance s in from the eave, for a roof of half-depth hd rising
// h (the profile prismPiece / capPiece build: one straight slope, or the mansard's steep band and shallow top)
function slopeHeight(shape, hd, h, s) {
  if (shape !== 'mansard' && shape !== 'gambrel') return (h * s) / hd;
  const sk = BAND_MANSARD * hd;
  const yk = RISE_MANSARD * h;
  return s <= sk ? (yk * s) / sk : yk + ((h - yk) * (s - sk)) / (hd - sk);
}
// ...and back: the distance in from the eave where the slope reaches height y (0 <= y <= h)
function slopeReach(shape, hd, h, y) {
  if (shape !== 'mansard' && shape !== 'gambrel') return (y * hd) / h;
  const sk = BAND_MANSARD * hd;
  const yk = RISE_MANSARD * h;
  return y <= yk ? (y * sk) / yk : sk + ((y - yk) * (hd - sk)) / (h - yk);
}

const DORMER_MAX = 3; // per slope ("a few")
const DORMER_DEPTH = 3.6; // m back into the roof at most: a dormer longer than that is a roof storey
// Dormers of one slope of a roof (shape, w along the ridge, d across, rise h, as roofs.add stages it after turning a
// hip's ridge onto the longer side), from `rand` (a seeded generator). The front wall stands `s0` in from the eave
// (just behind the wall line under the overhang, on a mansard low on its steep band), `base` up the slope; the dormer
// reaches back `depth` until the slope has risen to its own ridge, and stays 0.35 m under the main ridge. Returns
// null when the roof is too short for a dormer (low rise, shallow slope, short ridge), else
// { s0, base, dw, dh, depth, us } with `us` the dormer centres along the ridge (0 = the roof's centre).
function planDormers(shape, w, d, h, rand) {
  const hd = d * 0.5;
  if (!(h >= 2.2 && w >= 5 && hd >= 3)) return null;
  const mansard = shape === 'mansard' || shape === 'gambrel';
  const s0 = mansard ? 0.5 : 0.8;
  const base = slopeHeight(shape, hd, h, s0);
  const dw = 1.2 + rand() * 0.5;
  let dh = 1.3 + rand() * 0.4;
  // the dormer's full height (wall + its roof) must fit under the main ridge, on a mansard inside the steep band (up to
  // just past the knee), or its back would run far up the shallow top
  let room = h - 0.35 - base;
  if (mansard) room = Math.min(room, RISE_MANSARD * h + 0.2 - base);
  // and on a shallow slope a lower dormer keeps it from running back more than DORMER_DEPTH
  room = Math.min(room, slopeHeight(shape, hd, h, Math.min(hd, s0 + DORMER_DEPTH - 0.15)) - base);
  dh = Math.min(dh, room / (1 + DORMER_ROOF));
  if (dh < 1.0) return null;
  const back = slopeReach(shape, hd, h, base + dh * (1 + DORMER_ROOF));
  const depth = back - s0 + 0.15; // a little past the line where it meets the slope, so no gap shows
  if (depth > DORMER_DEPTH + 1e-6) return null;
  // usable half-length of the ridge: off the gable ends (party walls, chimney stacks), or for a hip inside the end
  // slopes at the dormer's back
  const half = (shape === 'hip' || shape === 'mansard' ? w * 0.5 - back - 0.2 : w * 0.5 - 1.0) - dw * 0.5;
  if (half < 0) return null;
  const bay = 4.4 + rand() * 1.6; // about every other window axis
  let n = Math.min(DORMER_MAX, Math.floor((2 * half) / bay) + 1);
  const span = Math.min(bay, n > 1 ? (2 * half) / (n - 1) : 0);
  const us = [];
  for (let k = 0; k < n; k++) us.push((k - (n - 1) * 0.5) * span);
  return { s0, base, dw, dh, depth, us };
}

// -------------------------------------------------------------------------------------------------------------------
// Rynek gable screens (szczyty): the attic wall a Stary Rynek kamieniczka raises in its facade plane in front of the
// gable end of its roof, taller than the roof and with a shaped skyline: 'stepped' (Gothic / Renaissance stepped
// gable: four steps a side and a top block) or 'volute' (Baroque: a pediment over two tiers, each tier's flank an
// ogee scroll curling at its foot, obelisk finials on the outer corners). Unit piece: x in [-0.5, 0.5] (scaled to the
// wall's width), y from 0 (the eave line) to 1 (scaled so the roof's ridge reaches GABLE_PEAK of it), z in
// [-0.5, 0.5] (thickness), front at +z. The outline is a height profile y(x), so the front and back are columns
// between its points and the skyline one strip per segment; the underside sits in the wall and is left out. Both
// outlines have ledges at y 0.4 and 0.8, where createGableScreenMaterial draws its string courses.
// -------------------------------------------------------------------------------------------------------------------
const GABLE_STYLES = ['stepped', 'volute'];
const GABLE_PEAK = { stepped: 0.8, volute: 0.72 }; // the roof's ridge height, of the screen's height
const GABLE_THICK = 0.45; // m; the front stands GABLE_PROUD in front of the wall it rises from
const GABLE_PROUD = 0.2;

// An ogee (S-curve) from (x0, y0) down to (x1, y1), convex at the top and concave at the foot: `steps` points, the
// first left out
function ogee(x0, y0, x1, y1, steps) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * t))]);
  }
  return pts;
}
// A scroll's curl seen side-on: a half disc of radius r on (cx, cy), from its left foot over the top to its right
function curl(cx, cy, r, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * (1 - i / steps);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// The half outline from the centre (x = 0) out to the outer corner (x = 0.5), as [x, y] points with x never
// decreasing (equal x: a vertical riser)
function gableHalf(style) {
  if (style === 'stepped') return stepped();
  const pts = [[0, 1], [0.14, 0.9], [0.14, 0.8], [0.18, 0.8]]; // pediment over a cornice
  pts.push(...ogee(0.18, 0.8, 0.285, 0.44, 6)); // the upper tier's flank
  pts.push(...curl(0.31, 0.44, 0.025, 4).slice(1)); // its curl
  pts.push([0.335, 0.4], [0.36, 0.4]); // the ledge of the lower tier
  pts.push(...ogee(0.36, 0.4, 0.405, 0.19, 5)); // the lower flank
  pts.push(...curl(0.425, 0.19, 0.02, 4).slice(1));
  pts.push([0.445, 0.27], [0.4725, 0.32], [0.5, 0.27]); // an obelisk finial on the corner
  return pts;
}
// Stepped half outline: the top block (|x| < 0.1) at 1.0, then treads at 0.8, 0.6, 0.4 and 0.2, 0.1 wide each
function stepped() {
  const pts = [[0, 1], [0.1, 1]];
  for (let k = 1; k <= 4; k++) {
    const y = 1 - 0.2 * k;
    pts.push([0.1 * k, y], [0.1 * (k + 1), y]);
  }
  return pts;
}

// The full skyline from x = -0.5 to 0.5 ([x, y], x never decreasing)
function gableOutline(style) {
  const half = gableHalf(style);
  const left = half.slice(1).reverse().map(([x, y]) => [-x, y]);
  return [...left, ...half];
}

function gablePiece(style) {
  const top = gableOutline(style);
  const polys = [];
  const uvOf = (x, y) => [x + 0.5, y];
  for (let i = 0; i + 1 < top.length; i++) {
    const [xa, ya] = top[i];
    const [xb, yb] = top[i + 1];
    // skyline strip, its normal out of the solid (the outline is walked left to right, the solid below it)
    const len = Math.hypot(xb - xa, yb - ya);
    if (len > 1e-9) {
      polys.push({
        pts: [[xa, ya, -0.5], [xb, yb, -0.5], [xb, yb, 0.5], [xa, ya, 0.5]],
        uv: [uvOf(xa, ya), uvOf(xb, yb), uvOf(xb, yb), uvOf(xa, ya)],
        n: [-(yb - ya) / len, (xb - xa) / len, 0]
      });
    }
    if (xb - xa < 1e-9) continue;
    // front and back columns
    for (const z of [-0.5, 0.5]) {
      polys.push({
        pts: [[xa, 0, z], [xb, 0, z], [xb, yb, z], [xa, ya, z]],
        uv: [uvOf(xa, 0), uvOf(xb, 0), uvOf(xb, yb), uvOf(xa, ya)],
        n: [0, 0, z * 2]
      });
    }
  }
  // the outer sides
  for (const [x, y, sx] of [[-0.5, top[0][1], -1], [0.5, top[top.length - 1][1], 1]]) {
    polys.push({ pts: [[x, 0, -0.5], [x, 0, 0.5], [x, y, 0.5], [x, y, -0.5]], uv: [uvOf(x, 0), uvOf(x, 0), uvOf(x, y), uvOf(x, y)], n: [sx, 0, 0] });
  }
  return buildPiece(polys, [0, 0.1, 0]);
}

function createGableGeometries() {
  return { stepped: gablePiece('stepped'), volute: gablePiece('volute') };
}

// sRGB hex → linear [r, g, b] (instance tints are working-space colours)
function linearRGB(hex) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

const PIECES = ['prism', 'hipCap', 'gambrel', 'mansardCap'];
const ROOF_SHAPES = ['gable', 'hip', 'mansard', 'gambrel'];
const ROOF_MATERIALS = ['tile', 'slate', 'copper'];
// Fallbacks when the caller has no material for a key: red ceramic tile, dark slate / sheet metal, copper patina
const FALLBACK_COLORS = { tile: 0xa34a30, slate: 0x4b5159, copper: 0x5e9c86 };
// Over the 8.2 × 5.7 km detail box buildCityBlocks stages 82.6k records (measured headless, 2026-10-28): 46.5k for the
// pitched roofs (a hip or mansard takes 3) and 36.1k for 18.0k dormers (body and window each). The former 64k pool
// (46.8k used over the 6.1 × 3.7 km box) ran full there and dropped the last blocks' roofs. 36 bytes a staged record
const MAX_ROOF_INSTANCES = 128000;
const STRIDE = 9; // x, y, z, sx, sy, sz, ry, mesh index, tint (sRGB hex; gable screens)

function createRoofGeometries() {
  return { prism: prismPiece(false), hipCap: capPiece(false), gambrel: prismPiece(true), mansardCap: capPiece(true) };
}

function createDormerGeometries() {
  return { dormer: dormerPiece(), window: windowPiece() };
}

// createRoofs({ materials: { tile, slate, copper, window, gable }, max, parent }) → the roof family. Meshes exist from
// the start (one per piece × material, the dormers per dormer material, one for all dormer windows, one per gable
// screen style; added to `parent` if given) so the build can register them; they get their instances in finish().
// Call order: add() / addDormers() / addGable()…
// (mark() / transform() per turned block) …, then finish() once, before scene culling
function createRoofs({ materials = {}, max = MAX_ROOF_INSTANCES, parent = null } = {}) {
  const geos = { ...createRoofGeometries(), ...createDormerGeometries() };
  const gableGeos = createGableGeometries();
  const mats = {};
  for (const key of ROOF_MATERIALS) {
    mats[key] = materials[key] || new THREE.MeshStandardNodeMaterial({ color: FALLBACK_COLORS[key], roughness: 0.8 });
  }
  const windowMat = materials.window || new THREE.MeshStandardNodeMaterial({ color: 0x1b2733, roughness: 0.2 });
  const gableMat = materials.gable || new THREE.MeshStandardNodeMaterial({ color: 0xe8dcc0, roughness: 0.85 });
  const meshes = [];
  const meshIndex = {}; // `${piece}:${material}` (or the piece alone) -> index into meshes
  const meshMeta = []; // per mesh: kindOf(matKey) when one mesh carries several kinds, else null
  function addMesh(key, geo, mat, name, kindOf = null) {
    // capacity 1 until finish() hands it an exact-size instanceMatrix
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshIndex[key] = meshes.length;
    meshMeta[meshes.length] = { kindOf };
    meshes.push(mesh);
    if (parent) parent.add(mesh);
    return meshes.length - 1;
  }
  // One material shared by the roof kinds lets one mesh per unit piece carry all of them: the kind is a per-instance
  // `roofKind` attribute (createRoofMaterial({ kinds })). Without a shared material the family keeps the per-kind
  // meshes (tests and any caller that wants separate materials). A multi-kind material must be passed under every roof
  // key, as buildings.js does, or the unmerged meshes would render the material's first kind only.
  const roofMat = mats.tile;
  const mergedRoof = mats.tile === mats.slate && mats.slate === mats.copper &&
    Array.isArray(roofMat.userData?.roofKinds) && ROOF_MATERIALS.every((key) => roofMat.userData.roofKinds.includes(key));
  const mergedDormer = mergedRoof && mats.tile === mats.slate;
  const kindOf = (mat) => (matKey) => mat.userData.roofKinds.indexOf(matKey);
  if (mergedRoof) {
    for (const piece of PIECES) {
      const mi = addMesh(piece, geos[piece], roofMat, `Roof-${piece}`, kindOf(roofMat));
      for (const key of ROOF_MATERIALS) meshIndex[`${piece}:${key}`] = mi;
    }
  } else {
    for (const key of ROOF_MATERIALS) {
      for (const piece of PIECES) addMesh(`${piece}:${key}`, geos[piece], mats[key], `Roof-${piece}-${key}`);
    }
  }
  if (mergedDormer) {
    const mi = addMesh('dormer', geos.dormer, mats.tile, 'Roof-dormer', kindOf(mats.tile));
    for (const key of DORMER_MATERIALS) meshIndex[`dormer:${key}`] = mi;
  } else {
    for (const key of DORMER_MATERIALS) addMesh(`dormer:${key}`, geos.dormer, mats[key], `Roof-dormer-${key}`);
  }
  addMesh('window', geos.window, windowMat, 'Roof-dormerWindow');
  // gable screens carry a per-instance `gableTint` (their house's render colour), so each gets its own geometry
  for (const style of GABLE_STYLES) addMesh(`gable:${style}`, gableGeos[style], gableMat, `Roof-gable-${style}`);

  const rec = new Float32Array(max * STRIDE);
  let n = 0;
  let finished = false;

  function push(mi, x, y, z, sx, sy, sz, ry, tint = 0, matKey = null) {
    const o = n++ * STRIDE;
    rec[o] = x;
    rec[o + 1] = y;
    rec[o + 2] = z;
    rec[o + 3] = sx;
    rec[o + 4] = sy;
    rec[o + 5] = sz;
    rec[o + 6] = ry;
    rec[o + 7] = mi;
    // Merged roof kinds use this slot for the per-instance kind; gable screens use it for their house tint.
    rec[o + 8] = meshMeta[mi] && meshMeta[mi].kindOf ? meshMeta[mi].kindOf(matKey) : tint; // 24-bit integers are exact in a float32
  }

  // Roof of shape ('gable' | 'hip' | 'mansard' | 'gambrel') and material ('tile' | 'slate' | 'copper') on the plan
  // w × d centred on (x, z) at eave height y, rising h, turned ry about y. w runs along local x, so a gable or gambrel
  // ridge runs along w; hip and mansard ridges always run along the longer side. Returns false (adding nothing) when
  // the shape or material is unknown, the size degenerate, the pool full or the family already finished
  function add(shape, mat, x, y, z, w, d, h, ry = 0) {
    if (finished || !(w > 0 && d > 0 && h > 0) || !mats[mat]) return false;
    if (shape === 'gable' || shape === 'gambrel') {
      if (n + 1 > max) return false;
      push(meshIndex[`${shape === 'gable' ? 'prism' : 'gambrel'}:${mat}`], x, y, z, w, h, d, ry, 0, mat);
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
    if (pieces === 3) push(meshIndex[`${mansard ? 'gambrel' : 'prism'}:${mat}`], x, y, z, mid, h, d, ry, 0, mat);
    // caps at both ends of the ridge, the far one turned half a turn so its x still runs out to the eave
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const off = mid * 0.5;
    push(cap, x + c * off, y, z - s * off, d * 0.5, h, d, ry, 0, mat);
    push(cap, x - c * off, y, z + s * off, d * 0.5, h, d, ry + Math.PI, 0, mat);
    return true;
  }

  // Dormers on the slopes of the roof add() stages with the same arguments (shape, mat, x, y, z, w, d, h, ry): per slope
  // planDormers' row, kept with probability opts.facing(dx, dz) of the slope's outward direction in this frame (the
  // street side more often than the courtyard), drawn from opts.rand. Nothing on copper or unknown materials, flat
  // shapes or short roofs. Each dormer is two records (body, window). Returns the number of dormers added
  function addDormers(shape, mat, x, y, z, w, d, h, ry, { rand, facing = () => 1 } = {}) {
    if (finished || !rand || meshIndex[`dormer:${mat}`] === undefined || !ROOF_SHAPES.includes(shape)) return 0;
    if ((shape === 'hip' || shape === 'mansard') && d > w) {
      const t = w;
      w = d;
      d = t;
      ry += Math.PI * 0.5;
    }
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    let added = 0;
    for (const sgn of [1, -1]) {
      // outward direction of this slope: the roof's local ±z turned by ry
      const dx = s * sgn;
      const dz = c * sgn;
      if (!(rand() < facing(dx, dz))) continue;
      const plan = planDormers(shape, w, d, h, rand);
      if (!plan) continue;
      const zf = sgn * (d * 0.5 - plan.s0);
      const yb = y + plan.base;
      const yaw = sgn > 0 ? ry : ry + Math.PI;
      for (const u of plan.us) {
        if (n + 2 > max) return added;
        const px = x + u * c + zf * s;
        const pz = z - u * s + zf * c;
        push(meshIndex[`dormer:${mat}`], px, yb, pz, plan.dw, plan.dh, plan.depth, yaw, 0, mat);
        push(meshIndex.window, px + dx * 0.03, yb + plan.dh * 0.14, pz + dz * 0.03, plan.dw * 0.6, plan.dh * 0.7, 1, yaw);
        added++;
      }
    }
    return added;
  }

  // Gable screen of `style` ('stepped' | 'volute') rising from the wall plane point (x, y, z) at the eave line, `w` wide
  // across the gable, in front of a roof whose ridge stands `rise` over y, its front facing ry (local +z turned by ry:
  // world (sin ry, cos ry)), rendered in `tint` (sRGB hex). Its height is rise / GABLE_PEAK, so the skyline clears
  // the roof everywhere. Returns false for an unknown style, a full pool or a finished family
  function addGable(style, x, y, z, w, rise, ry, tint) {
    if (finished || meshIndex[`gable:${style}`] === undefined || !(w > 0 && rise > 0) || n + 1 > max) return false;
    const off = GABLE_PROUD - GABLE_THICK * 0.5;
    push(meshIndex[`gable:${style}`], x + Math.sin(ry) * off, y, z + Math.cos(ry) * off, w, rise / GABLE_PEAK[style], GABLE_THICK, ry, tint);
    return true;
  }

  // Number of instances staged so far; take it before populating a turned block and pass it to transform() after
  function mark() {
    return n;
  }

  // Discard a staged building without changing the random draws its layout consumed.
  function rewind(from) {
    n = from;
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
    // per-instance tints of the gable screens and kinds of the merged roof meshes, in instance order
    const tints = {};
    const kinds = {};
    for (const style of GABLE_STYLES) {
      const k = meshIndex[`gable:${style}`];
      tints[k] = { arr: new Float32Array(Math.max(1, counts[k]) * 3), i: 0 };
    }
    for (let k = 0; k < meshes.length; k++) {
      if (meshMeta[k].kindOf) kinds[k] = { arr: new Float32Array(Math.max(1, counts[k])), i: 0 };
    }
    for (let i = 0; i < n; i++) {
      const mi = rec[i * STRIDE + 7];
      const t = tints[mi];
      if (t) t.arr.set(linearRGB(rec[i * STRIDE + 8]), t.i++ * 3);
      const kind = kinds[mi];
      if (kind) kind.arr[kind.i++] = rec[i * STRIDE + 8];
    }
    meshes.forEach((mesh, k) => {
      if (tints[k]) mesh.geometry.setAttribute('gableTint', new THREE.InstancedBufferAttribute(tints[k].arr, 3));
      if (kinds[k]) mesh.geometry.setAttribute('roofKind', new THREE.InstancedBufferAttribute(kinds[k].arr, 1));
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

  return { meshes, add, addDormers, addGable, mark, rewind, transform, finish, count: () => n };
}

export {
  createRoofs,
  createRoofGeometries,
  createDormerGeometries,
  createGableGeometries,
  gableOutline,
  planDormers,
  slopeHeight,
  ROOF_SHAPES,
  ROOF_MATERIALS,
  DORMER_ROOF,
  GABLE_STYLES,
  GABLE_PEAK,
  MAX_ROOF_INSTANCES
};
