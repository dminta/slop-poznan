import * as THREE from 'three/webgpu';
import { addMesh, box, cylinder, prism, collider, fitToSite, site } from './landmark-kit.js';

// js/landmarks-stadium.js
// Enea Stadion (Stadion Miejski w Poznaniu, ul. Bułgarska 17), the home ground of Lech Poznań. The new stadium was
// rebuilt in 2003–2010 by Modern Construction Systems (Wojciech Ryżyński): four two/three-tier stands around a
// 105 × 68 m pitch, covered by a pale membrane roof carried on four steel lattice trusses anchored in the corners,
// with the highest truss point at 56 m (the OSM relation 2240375 tags height 56). The facade is the contemporary
// Poznań version: a dark glazed band behind close-set white vertical louvres, with a 450 m promenade at +6.6 m and a
// concrete corner core under each truss (mconstructions.pl, inzynierbudownictwa.pl, stadiumdb.com).
//
// The model is authored unrotated around the pitch; the site in city-config.js carries the OSM outline's minimum-area
// orientation (ang ≈ -0.5605 rad, 32.1°) and fitToSite turns the model and its colliders onto the real lot. The
// outer boundary is an octagon (207.5 × 219.0 m with 43 m corner chamfers) rather than the full rectangle, because
// the real outline has the same rounded-square corners: the full rectangle would overhang its OSM box once turned.
//
// `fitToSite` would silently skip a missing site. This fallback is the data city-config.js adds when the OSM landmark
// snapshot does not carry the stadium, so the model never disappears from the world.

const ENEA_STADIUM = { x: -5160.2, z: 1211.7, w: 250.9, d: 251.0, h: 56, ang: -0.5605 };

const OUTER_X = 103.75;
const OUTER_Z = 109.5;
const CHAMFER = 43;
const INNER_X = 56.5;
const INNER_Z = 40;
const PITCH_X = 52.5;
const PITCH_Z = 34;
const TIERS = 10;
const TIER_H = 2.7;
const ROOF_Y = 39.2;
const APEX_Y = 55.0;
const PYLON_X = 80;
const PYLON_Z = 86;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// A thin round member from a to b: 4-sided and open-ended, so the four lattice trusses stay cheap.
function strut(parent, a, b, r, material) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  const m = addMesh(parent, new THREE.CylinderGeometry(r, r, len, 4, 1, true), material,
    (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, _dir.normalize());
  return m;
}

// Half-width of the outer octagon at |z|: full width up to the chamfer, then 45° in.
function outerHalfX(z) {
  const a = Math.abs(z);
  const corner = OUTER_Z - CHAMFER;
  return a <= corner ? OUTER_X : OUTER_X - (a - corner);
}

// A vertical louvre run from a to b ([x, z]); `gapAt` skips the entrance bay.
function louvreRun(parent, a, b, material, gapAt) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 3.6));
  const ry = -Math.atan2(dz, dx);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + dx * t;
    const z = a[1] + dz * t;
    if (gapAt && gapAt(x, z)) continue;
    box(parent, 0.35, 39.2, 1.3, material, x, 0, z, ry);
  }
}

// The four outer edges of the stadium octagon, clockwise from the north-east corner.
const OCTAGON = [
  [60.75, 109.5], [103.75, 66.5], [103.75, -66.5], [60.75, -109.5],
  [-60.75, -109.5], [-103.75, -66.5], [-103.75, 66.5], [-60.75, 109.5]
];

function buildStadiumLandmarks({ group, colliders, M }) {
  const c0 = colliders.length;
  const obj = new THREE.Group();

  // ---------------------------------------------------------------------------------------------------------------
  // Pitch and its markings: 105 × 68 m, the OSM/league dimensions, on a 121 × 84 m grass apron.
  // ---------------------------------------------------------------------------------------------------------------
  box(obj, 121, 0.12, 84, M.hedge, 0, 0, 0);
  const LINE = 0.14;
  const lineX = (len, x, z) => box(obj, len, 0.035, 0.12, M.plasterWhite, x, LINE, z);
  const lineZ = (len, x, z) => box(obj, 0.12, 0.035, len, M.plasterWhite, x, LINE, z);
  lineX(2 * PITCH_X, 0, -PITCH_Z);
  lineX(2 * PITCH_X, 0, PITCH_Z);
  lineZ(2 * PITCH_Z, -PITCH_X, 0);
  lineZ(2 * PITCH_Z, PITCH_X, 0);
  lineZ(2 * PITCH_Z, 0, 0);
  // Centre circle: 24 short tangent strips on a 9.15 m radius.
  const SEG = 24;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    const x0 = Math.cos(a0) * 9.15;
    const z0 = Math.sin(a0) * 9.15;
    const x1 = Math.cos(a1) * 9.15;
    const z1 = Math.sin(a1) * 9.15;
    box(obj, Math.hypot(x1 - x0, z1 - z0), 0.035, 0.12, M.plasterWhite, (x0 + x1) / 2, LINE, (z0 + z1) / 2,
      -Math.atan2(z1 - z0, x1 - x0));
  }
  // Penalty and goal areas, penalty spots and the two goals.
  for (const s of [-1, 1]) {
    lineX(16.5, s * (PITCH_X - 8.25), -20.16);
    lineX(16.5, s * (PITCH_X - 8.25), 20.16);
    lineZ(40.32, s * (PITCH_X - 16.5), 0);
    lineX(5.5, s * (PITCH_X - 2.75), -9.16);
    lineX(5.5, s * (PITCH_X - 2.75), 9.16);
    lineZ(18.32, s * (PITCH_X - 5.5), 0);
    box(obj, 0.36, 0.035, 0.36, M.plasterWhite, s * (PITCH_X - 11), LINE, 0);
    for (const z of [-3.66, 3.66]) cylinder(obj, 0.08, 0.08, 2.44, 6, M.plasterWhite, s * PITCH_X, LINE, z);
    box(obj, 0.12, 0.12, 7.32, M.plasterWhite, s * PITCH_X, LINE + 2.44, 0);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Stands. The north/south tiers follow the octagon's 45° corner chamfer; the east/west stands fill the two straight
  // sides. Each tier is a solid trapezoid prism, so the terraces read as a stepped bowl from the pitch.
  // ---------------------------------------------------------------------------------------------------------------
  const longStep = (OUTER_Z - INNER_Z) / TIERS;
  for (const s of [-1, 1]) {
    for (let i = 0; i < TIERS; i++) {
      const z0 = INNER_Z + i * longStep;
      const z1 = z0 + longStep;
      const hw0 = outerHalfX(z0);
      const hw1 = outerHalfX(z1);
      const y = i * TIER_H;
      prism(obj, [[-hw0, s * z0], [hw0, s * z0], [hw1, s * z1], [-hw1, s * z1]], TIER_H, M.concrete, 0, y, 0);
      box(obj, 2 * hw0, 0.3, 0.5, M.plasterWhite, 0, y + TIER_H - 0.3, s * (z0 + 0.25));
    }
  }
  const sideStep = (OUTER_X - INNER_X) / TIERS;
  for (const s of [-1, 1]) {
    for (let i = 0; i < TIERS; i++) {
      const x0 = INNER_X + i * sideStep;
      const y = i * TIER_H;
      box(obj, sideStep + 0.1, TIER_H, 2 * INNER_Z, M.concrete, s * (x0 + sideStep / 2), y, 0);
      box(obj, 0.5, 0.3, 2 * INNER_Z, M.plasterWhite, s * (x0 + 0.25), y + TIER_H - 0.3, 0);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Facade: dark glazing behind close-set white louvres, a promenade at +6.6 m, four entrance portals, and the
  // concrete corner cores that carry the roof trusses.
  // ---------------------------------------------------------------------------------------------------------------
  const shortSide = 2 * (OUTER_X - CHAMFER);
  const longSide = 2 * (OUTER_Z - CHAMFER);
  const chamferLen = Math.hypot(CHAMFER, CHAMFER);
  for (const s of [-1, 1]) {
    box(obj, shortSide, 20, 0.7, M.glass, 0, 7, s * (OUTER_Z + 0.1));
    box(obj, shortSide, 12.2, 0.8, M.glass, 0, 27, s * (OUTER_Z + 0.1));
    box(obj, 0.7, 20, longSide, M.glass, s * (OUTER_X + 0.1), 7, 0);
    box(obj, 0.8, 12.2, longSide, M.glass, s * (OUTER_X + 0.1), 27, 0);
    box(obj, shortSide, 0.5, 2.6, M.plasterWhite, 0, 6.3, s * (OUTER_Z + 0.8));
    box(obj, 2.6, 0.5, longSide, M.plasterWhite, s * (OUTER_X + 0.8), 6.3, 0);
    box(obj, 20, 9, 1.4, M.darkMetal, 0, 0, s * (OUTER_Z + 0.25));
    box(obj, 24, 0.7, 4, M.plasterWhite, 0, 9, s * (OUTER_Z + 1.2));
    box(obj, 1.4, 9, 20, M.darkMetal, s * (OUTER_X + 0.25), 0, 0);
    box(obj, 4, 0.7, 24, M.plasterWhite, s * (OUTER_X + 1.2), 9, 0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ry = sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4;
      const cx = sx * (OUTER_X - CHAMFER / 2);
      const cz = sz * (OUTER_Z - CHAMFER / 2);
      box(obj, chamferLen, 20, 0.7, M.glass, cx + sx * 0.1, 7, cz + sz * 0.1, ry);
      box(obj, chamferLen, 12.2, 0.8, M.glass, cx + sx * 0.1, 27, cz + sz * 0.1, ry);
      box(obj, chamferLen, 0.5, 2.6, M.plasterWhite, cx + sx * 0.8, 6.3, cz + sz * 0.8, ry);
      box(obj, 8, 17, 8, M.concrete, sx * PYLON_X, 27, sz * PYLON_Z);
      box(obj, 9, 1.2, 9, M.steel, sx * PYLON_X, 44, sz * PYLON_Z);
      collider(colliders, sx * PYLON_X - 4, sx * PYLON_X + 4, sz * PYLON_Z - 4, sz * PYLON_Z + 4, 56);
    }
  }
  for (let i = 0; i < OCTAGON.length; i++) {
    const a = OCTAGON[i];
    const b = OCTAGON[(i + 1) % OCTAGON.length];
    const gap = (x, z) => (a[1] === b[1] ? Math.abs(x) < 12 : (a[0] === b[0] ? Math.abs(z) < 12 : false));
    louvreRun(obj, a, b, M.plasterWhite, gap);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Roof: a flat pale membrane ring at +39.2 m, its edge beam, the four steel lattice arches to 56 m, and the
  // cantilever struts that carry the inner edge over the top rows.
  // ---------------------------------------------------------------------------------------------------------------
  const northRoof = [
    [-OUTER_X, INNER_Z], [OUTER_X, INNER_Z], [OUTER_X, OUTER_Z - CHAMFER], [OUTER_X - CHAMFER, OUTER_Z],
    [-(OUTER_X - CHAMFER), OUTER_Z], [-OUTER_X, OUTER_Z - CHAMFER]
  ];
  prism(obj, northRoof, 0.6, M.plasterWhite, 0, ROOF_Y, 0);
  prism(obj, northRoof.map(([x, z]) => [x, -z]), 0.6, M.plasterWhite, 0, ROOF_Y, 0);
  for (const s of [-1, 1]) {
    prism(obj, [[s * INNER_X, -INNER_Z], [s * OUTER_X, -INNER_Z], [s * OUTER_X, INNER_Z], [s * INNER_X, INNER_Z]],
      0.6, M.plasterWhite, 0, ROOF_Y, 0);
  }
  // Membrane seams: the real roof is divided into 9 m panels.
  for (let x = -54; x <= 54; x += 9) {
    box(obj, 0.12, 0.1, OUTER_Z - INNER_Z, M.zinc, x, ROOF_Y + 0.62, INNER_Z + (OUTER_Z - INNER_Z) / 2);
    box(obj, 0.12, 0.1, OUTER_Z - INNER_Z, M.zinc, x, ROOF_Y + 0.62, -(INNER_Z + (OUTER_Z - INNER_Z) / 2));
  }
  for (let z = -36; z <= 36; z += 9) {
    box(obj, OUTER_X - INNER_X, 0.1, 0.12, M.zinc, INNER_X + (OUTER_X - INNER_X) / 2, ROOF_Y + 0.62, z);
    box(obj, OUTER_X - INNER_X, 0.1, 0.12, M.zinc, -(INNER_X + (OUTER_X - INNER_X) / 2), ROOF_Y + 0.62, z);
  }
  // Outer edge beam and the fascia round the open pitch.
  for (let i = 0; i < OCTAGON.length; i++) {
    const a = OCTAGON[i];
    const b = OCTAGON[(i + 1) % OCTAGON.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const ry = -Math.atan2(dz, dx);
    box(obj, len, 0.5, 1.2, M.zinc, (a[0] + b[0]) / 2, ROOF_Y - 0.1, (a[1] + b[1]) / 2, ry);
  }
  for (const s of [-1, 1]) {
    box(obj, 2 * INNER_X, 0.5, 0.7, M.zinc, 0, ROOF_Y - 0.1, s * INNER_Z);
    box(obj, 0.7, 0.5, 2 * INNER_Z, M.zinc, s * INNER_X, ROOF_Y - 0.1, 0);
  }
  // Cantilever struts from the back of the stands up to the roof's inner edge.
  for (let x = -54; x <= 54; x += 18) {
    for (const s of [-1, 1]) strut(obj, [x, 27, s * 100], [x, ROOF_Y - 0.2, s * 45], 0.3, M.zinc);
  }
  for (let z = -30; z <= 30; z += 15) {
    for (const s of [-1, 1]) strut(obj, [s * 100, 27, z], [s * 60, ROOF_Y - 0.2, z], 0.3, M.zinc);
  }
  // Four lattice trusses, their ends on the corner cores and their apex floodlight banks at exactly 56 m. The ~360
  // members use M.zinc (a batched metal) rather than the deliberately unbatched M.steel, which stays on the corner
  // caps.
  for (const s of [-1, 1]) {
    archTruss(obj, 'x', s * PYLON_Z, PYLON_X, 45.2, APEX_Y, M);
    archTruss(obj, 'z', s * PYLON_X, PYLON_Z, 45.2, APEX_Y, M);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Colliders: the four stand bands follow the octagon (the chamfered corner bays are not blocked outside the bowl);
  // the corner cores carry the 56 m truss line. The pitch opening stays free between them.
  // ---------------------------------------------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    collider(colliders, -OUTER_X, OUTER_X, s > 0 ? INNER_Z : -(OUTER_Z - CHAMFER),
      s > 0 ? OUTER_Z - CHAMFER : -INNER_Z, 40);
    collider(colliders, -(OUTER_X - CHAMFER), OUTER_X - CHAMFER, s > 0 ? OUTER_Z - CHAMFER : -OUTER_Z,
      s > 0 ? OUTER_Z : -(OUTER_Z - CHAMFER), 40);
  }
  // The four 45° corner walls: a staircase of eight small boxes each, so the barrier follows the chamfer without a
  // single box that would reach past the OSM envelope.
  const chamferStep = CHAMFER / 8;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        const x0 = sx * (OUTER_X - k * chamferStep);
        const x1 = sx * (OUTER_X - (k + 1) * chamferStep);
        const z0 = sz * (OUTER_Z - CHAMFER + k * chamferStep);
        const z1 = sz * (OUTER_Z - CHAMFER + (k + 1) * chamferStep);
        collider(colliders, Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), 40);
      }
    }
  }
  collider(colliders, INNER_X, OUTER_X, -INNER_Z, INNER_Z, 40);
  collider(colliders, -OUTER_X, -INNER_X, -INNER_Z, INNER_Z, 40);

  group.add(obj);
  fitToSite([obj], site('Enea Stadion') || ENEA_STADIUM, colliders, c0, { height: 56 });
}

// A lattice arch in a vertical plane: upper and lower chords, posts and diagonals. `along` is the span axis.
function archTruss(parent, along, at, halfSpan, baseY, apexY, M) {
  const N = 18;
  const up = [];
  const low = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = -halfSpan + 2 * halfSpan * t;
    const y = baseY + (apexY - baseY) * (1 - (s / halfSpan) ** 2);
    up.push(along === 'x' ? [s, y, at] : [at, y, s]);
    low.push(along === 'x' ? [s, y - 3, at] : [at, y - 3, s]);
  }
  for (let i = 0; i < N; i++) {
    strut(parent, up[i], up[i + 1], 0.3, M.zinc);
    strut(parent, low[i], low[i + 1], 0.22, M.zinc);
    strut(parent, up[i], low[i], 0.16, M.zinc);
    if (i < N - 1) strut(parent, up[i], low[i + 1], 0.12, M.zinc);
  }
  if (along === 'x') {
    box(parent, 7, 1, 1.6, M.plasterWhite, 0, apexY, at);
    box(parent, 6, 0.5, 1.8, M.glass, 0, apexY + 0.1, at);
  } else {
    box(parent, 1.6, 1, 7, M.plasterWhite, at, apexY, 0);
    box(parent, 1.8, 0.5, 6, M.glass, at, apexY + 0.1, 0);
  }
}

export { buildStadiumLandmarks };
