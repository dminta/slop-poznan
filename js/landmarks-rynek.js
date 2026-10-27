import * as THREE from 'three/webgpu';
import { fitToSite, addMesh, box, cylinder, lathe, pitchedRoof, profileSlab, collider, site } from './landmark-kit.js';

// js/landmarks-rynek.js
// Stary Rynek's central block: the Ratusz with its loggia, attic and tower (and the koziołki, the noon goats), the
// Domki Budnicze arcaded row south of it, and the Wieża Wójtowska house. The kamienice round the square are not built
// from buildArcadedHouseRow: they are buildings.js rynekHouses (batched facade boxes with roofs.js gables and their
// stepped / volute screens).

// -------------------------------------------------------------------------------------------------------------------
// Shared bits
// -------------------------------------------------------------------------------------------------------------------

// The face of one arcade bay as a single inverted-U outline (no holes, so profileSlab can extrude it): a w-wide bay
// from y0 to y1 with a round arch of the bay's clear width (w - pier) springing at springY
function archBayOutline(w, pier, y0, y1, springY, segments = 8) {
  const hw = w / 2;
  const r = (w - pier) / 2;
  const pts = [[-hw, y0], [-hw, y1], [hw, y1], [hw, y0], [r, y0], [r, springY]];
  for (let i = 1; i < segments; i++) {
    const a = (i / segments) * Math.PI;
    pts.push([Math.cos(a) * r, springY + Math.sin(a) * r]);
  }
  pts.push([-r, springY], [-r, y0]);
  return pts;
}

// A round-headed panel outline, w wide and h tall: blind niches
function roundArchOutline(w, h, segments = 8) {
  const r = w / 2;
  const pts = [[-r, 0], [r, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI;
    pts.push([Math.cos(a) * r, h - r + Math.sin(a) * r]);
  }
  return pts;
}

// An equilateral pointed (Gothic) arch panel outline, w wide and h tall: each side is an arc of radius w centred on
// the opposite springer, so the apex stands 0.866 w over the springing line
function pointedArchOutline(w, h, segments = 5) {
  const hw = w / 2;
  const spring = h - 0.866 * w;
  const pts = [[-hw, 0], [hw, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * (Math.PI / 3);
    pts.push([-hw + Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  for (let i = segments - 1; i >= 0; i--) {
    const a = (i / segments) * (Math.PI / 3);
    pts.push([hw - Math.cos(a) * w, spring + Math.sin(a) * w]);
  }
  return pts;
}

// A disc (clock face, medallion) of radius r and thickness t facing ±x ('x') or ±z ('z'), centred at (x, y, z)
function disc(parent, r, t, material, x, y, z, axis = 'x', segments = 16) {
  const m = addMesh(parent, new THREE.CylinderGeometry(r, r, t, segments), material, x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else m.rotation.x = Math.PI / 2;
  return m;
}

// -------------------------------------------------------------------------------------------------------------------
// Arcaded house row (Domki Budnicze). The row runs along local z from
// z0, the fronts face +x: every house is `depth` deep (x -depth/2..depth/2), has a ground-floor arcade (podcienie)
// `arcadeDepth` deep under its upper floors, `storeys` floors in all and a gable to the front under a pitched roof
// with its ridge across the row (the saw-tooth Rynek skyline). `houses`: [{ width, storeys, wall, windows }], wall a
// plain plaster material (pastels), windows 1 or 2 per floor. Returns the top height and the row's length.
// -------------------------------------------------------------------------------------------------------------------
function buildArcadedHouseRow(parent, M, {
  houses,
  depth = 8,
  z0 = 0,
  groundHeight = 3.4,
  storeyHeight = 2.8,
  arcadeDepth = 2.4,
  gableHeight = 2.6,
  roof = M.tileRed,
  trim = M.plasterWhite
}) {
  const fx = depth / 2;
  let z = z0;
  let top = 0;
  for (const h of houses) {
    const w = h.width;
    const zc = z + w / 2;
    const eave = groundHeight + (h.storeys - 1) * storeyHeight;
    const wall = h.wall;
    // Shop/back rooms behind the arcade, and the upper floors over it
    box(parent, depth - arcadeDepth, groundHeight, w, wall, -arcadeDepth / 2, 0, zc);
    box(parent, depth, eave - groundHeight, w, wall, 0, groundHeight, zc);
    // Arcade front: one round arch per house between half piers, a string course over it
    const arch = archBayOutline(w, 0.7, 0, groundHeight, groundHeight - 0.35 - (w - 0.7) / 2);
    profileSlab(parent, arch, 0.5, wall, fx - 0.25, 0, zc, Math.PI / 2);
    box(parent, 0.2, 0.18, w, trim, fx + 0.05, groundHeight, zc);
    // A glazed door and shop window at the back of the arcade
    box(parent, 0.06, 2.4, Math.min(w - 1.2, 2.6), M.glass, fx - arcadeDepth + 0.02, 0.2, zc);
    // Windows: 1 or 2 per floor on both long faces, with a sill band per floor
    const nWin = h.windows || (w > 4.6 ? 2 : 1);
    for (let s = 1; s < h.storeys; s++) {
      const y = groundHeight + (s - 1) * storeyHeight + 0.7;
      for (let k = 0; k < nWin; k++) {
        const wz = zc + (nWin === 1 ? 0 : (k - 0.5) * w * 0.45);
        box(parent, 0.06, 1.5, 0.9, M.glass, fx + 0.02, y, wz);
        box(parent, 0.06, 1.5, 0.9, M.glass, -fx - 0.02, y, wz);
        box(parent, 0.14, 0.1, 1.15, trim, fx + 0.05, y - 0.1, wz);
      }
    }
    // Gable roof with its ridge front to back, and plastered gable walls flush with both faces (they hide the
    // roof's own end triangles), each with a small attic window and a white coping
    const gh = gableHeight * Math.min(1, w / 4.4);
    pitchedRoof(parent, depth, w, gh, roof, 0, eave, zc, { ridge: 'x' });
    const gable = [[-w / 2, 0], [w / 2, 0], [0, gh]];
    profileSlab(parent, gable, 0.3, wall, fx - 0.1, eave, zc, Math.PI / 2);
    profileSlab(parent, gable, 0.3, wall, -fx + 0.1, eave, zc, Math.PI / 2);
    box(parent, 0.06, 0.9, 0.6, M.glass, fx + 0.06, eave + 0.3, zc);
    box(parent, 0.3, 0.16, w, trim, fx + 0.08, eave - 0.16, zc);
    top = Math.max(top, eave + gh);
    z += w;
  }
  return { top, length: z - z0 };
}

// -------------------------------------------------------------------------------------------------------------------
// Koziołki: two goats come out above the Ratusz clock at noon and butt heads 12 times. A show starts when the
// lighting preset becomes 'midday' and repeats every SHOW_PERIOD while it stays there (real clocks run it once a
// day; two minutes keeps it findable without being constant). Timeline in seconds from the start of a show:
// -------------------------------------------------------------------------------------------------------------------
const SHOW_PERIOD = 120;
const GOAT_SHOW = {
  doorsOpen: 1.5, // doors swing open 0 → 90°
  slideOut: 4.0, // goats roll out onto the ledge
  turnIn: 5.0, // and turn to face each other
  butts: 12,
  buttPeriod: 1.25, // rear back (70 %), lunge (30 %)
  turnOut: 1.0,
  slideIn: 2.5,
  doorsClose: 1.5
};
// Goat pivot positions (Ratusz local metres): u in the wall → on the ledge; w ± apart while facing each other
const GOAT_U_IN = 17.4;
const GOAT_U_OUT = 18.55;
const GOAT_W_REST = 0.85;
const GOAT_W_HIT = 0.64; // head tips touch at w = 0
const GOAT_W_BACK = 0.95;
const GOAT_REAR = 0.32; // rad, how far a goat rears up on its hind legs before the lunge

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// A goat about 1 m long and 0.75 m tall facing local +x; the returned `rear` group pivots at the hind feet so the goat
// can rear up (rotation.z) before butting
function buildGoat(M) {
  const goat = new THREE.Group();
  const rear = new THREE.Group();
  rear.position.x = -0.3;
  goat.add(rear);
  const coat = M.plasterWhite;
  box(rear, 0.1, 0.36, 0.26, coat, 0.06, 0, 0); // hind legs
  box(rear, 0.1, 0.36, 0.26, coat, 0.54, 0, 0); // forelegs
  box(rear, 0.7, 0.32, 0.32, coat, 0.3, 0.34, 0); // body
  box(rear, 0.18, 0.26, 0.16, coat, 0.66, 0.5, 0); // neck
  box(rear, 0.26, 0.2, 0.2, coat, 0.82, 0.62, 0); // head
  box(rear, 0.06, 0.14, 0.08, M.stoneGrey, 0.9, 0.5, 0); // beard
  for (const s of [-1, 1]) {
    const horn = addMesh(rear, new THREE.ConeGeometry(0.045, 0.3, 6), M.bronze, 0.74, 0.88, s * 0.06);
    horn.rotation.z = 0.7; // swept back over the neck
  }
  return { goat, rear };
}

// -------------------------------------------------------------------------------------------------------------------
// Ratusz. Measures: OSM way 30611684 (35.9 × 20.8 m; local x = u faces ≈ east, z = w ≈ south). Main block
// u -17.2..12.7 × w ±9, the loggia front u 12.7..18 × w ±10.4, pilaster risalits at u -6..-2 and 1..4.4 on both
// long sides (centred on the tower, which rises over the middle of the block), a stair bay at the NW corner.
// Heights: tower 61 m with the eagle (poznan-plan §9.1; pl.wikipedia "Ratusz w Poznaniu": the 1783 copper eagle is
// 1.8 m tall with a 2 m span), walls 16 m over three storeys, the attic to ≈ 24.5 m (photos: about half the loggia's
// height).
// -------------------------------------------------------------------------------------------------------------------
const RATUSZ = {
  wallTop: 16,
  atticTop: 24.5,
  front: 18, // loggia / attic face (u)
  frontHalf: 10.4,
  towerU: -0.6,
  towerHalf: 3.6,
  levels: [[0, 5.6], [5.6, 11], [11, 16]] // loggia storeys [y0, y1]
};

function buildRatusz({ group, dynamic, colliders, M }) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const R = RATUSZ;
  const wallTop = R.wallTop;

  // --- Main block, stair bay and risalits
  box(obj, 29.9, wallTop, 18, M.plasterCream, -2.25, 0, 0);
  box(obj, 2.2, wallTop + 0.6, 2.6, M.plasterCream, -16.9, 0, -8.4);
  for (const [u0, u1, side] of [[-5, -2.2, -1], [0.8, 4.1, -1], [-6.2, -3, 1], [1.1, 4.4, 1]]) {
    box(obj, u1 - u0, wallTop + 0.4, 1.4, M.plasterCream, (u0 + u1) / 2, 0, side * 9.65);
  }
  // Plinth and the crowning cornice; painted ochre bands between the storeys
  box(obj, 30.3, 0.9, 18.4, M.sandstone, -2.25, 0, 0);
  box(obj, 30.5, 0.5, 18.6, M.plasterWhite, -2.25, wallTop - 0.5, 0);
  for (const y of [5.4, 10.8]) box(obj, 30.1, 0.35, 18.2, M.plasterOchre, -2.25, y, 0);
  // Windows on the long sides (skipping the risalits) and the west end, three storeys
  const sideU = [-15, -11.8, -8.6, -0.7, 6.6, 9.6];
  for (const [y, h] of [[1.6, 2.6], [6.6, 3], [11.8, 2.8]]) {
    for (const u of sideU) {
      for (const s of [-1, 1]) box(obj, 1.4, h, 0.06, M.glass, u, y, s * 9.03);
    }
    for (const w of [-5.5, -1.8, 1.8, 5.5]) box(obj, 0.06, h, 1.4, M.glass, -17.23, y, w);
  }
  // Hipped roof (bluish slate) over the main block, its east end hidden behind the attic
  pitchedRoof(obj, 30.4, 18.4, 8, M.slate, -2.25, wallTop, 0, { ridge: 'x', hip: 0.55 });

  // --- East loggia: back wall with doors and windows, floors, three storeys of five arcades with balustrades
  const fh = R.frontHalf;
  box(obj, 0.6, wallTop, 2 * fh, M.plasterCream, 13.0, 0, 0);
  box(obj, R.front - 12.7, wallTop, 0.6, M.plasterCream, (R.front + 12.7) / 2, 0, -fh + 0.3);
  box(obj, R.front - 12.7, wallTop, 0.6, M.plasterCream, (R.front + 12.7) / 2, 0, fh - 0.3);
  const bays = 5;
  const bw = (2 * fh) / bays;
  for (const [y0, y1] of R.levels) {
    const spring = y1 - 0.6 - (bw - 0.8) / 2;
    for (let i = 0; i < bays; i++) {
      const w = -fh + bw * (i + 0.5);
      profileSlab(obj, archBayOutline(bw, 0.8, y0, y1, spring), 0.5, M.plasterWhite, R.front - 0.25, 0, w, Math.PI / 2);
      box(obj, 0.06, Math.min(2.6, y1 - y0 - 2.2), 1.3, M.glass, 13.32, y0 + 0.6, w); // door / window in the back wall
      if (y0 > 0) box(obj, 0.25, 1.0, bw - 0.8, M.plasterWhite, R.front - 0.3, y0, w); // balustrade
    }
    if (y0 > 0) box(obj, R.front - 13.3, 0.3, 2 * fh - 1.2, M.stoneGrey, (R.front + 13.3) / 2, y0 - 0.3, 0); // floor
    // painted frieze (medallions on ochre) over each level
    box(obj, 0.12, 0.6, 2 * fh, M.plasterOchre, R.front + 0.02, y1 - 0.6, 0);
    for (let i = 0; i <= bays; i++) disc(obj, 0.26, 0.1, M.gold, R.front + 0.1, y1 - 0.3, -fh + bw * i, 'x', 10);
  }
  box(obj, 0.8, 0.5, 2 * fh + 0.4, M.plasterWhite, R.front - 0.2, wallTop - 0.1, 0); // cornice under the attic

  // --- Attic: a tall decorated screen wall over the loggia hiding the roof, with blind niches (the painted kings),
  // the clock and the goats' doors on the axis, and three turrets (the middle one taller)
  const atticH = R.atticTop - wallTop;
  box(obj, 0.6, atticH, 2 * fh, M.plasterWhite, R.front - 0.3, wallTop, 0);
  box(obj, 5.2, atticH, 0.5, M.plasterWhite, R.front - 2.6, wallTop, -fh + 0.25); // short returns on the sides
  box(obj, 5.2, atticH, 0.5, M.plasterWhite, R.front - 2.6, wallTop, fh - 0.25);
  for (const w of [-8.4, -6.2, -4.0, 4.0, 6.2, 8.4]) {
    // rows of blind round-headed niches with the painted Jagiellonians (ochre)
    profileSlab(obj, roundArchOutline(1.5, 4.2), 0.1, M.plasterOchre, R.front + 0.02, wallTop + 1.4, w, Math.PI / 2);
    box(obj, 0.2, atticH - 0.4, 0.3, M.plasterCream, R.front + 0.05, wallTop + 0.2, w + 1.1); // pilasters
  }
  box(obj, 0.9, 0.4, 2 * fh + 0.4, M.plasterWhite, R.front - 0.3, R.atticTop - 0.4, 0); // coping
  // Clock on the axis, the goats' ledge and dark niche above it
  disc(obj, 1.25, 0.15, M.plasterWhite, R.front + 0.08, 19.6, 0, 'x', 20);
  disc(obj, 1.42, 0.1, M.gold, R.front + 0.04, 19.6, 0, 'x', 20);
  box(obj, 0.06, 0.65, 0.12, M.darkMetal, R.front + 0.17, 19.6, 0); // both hands at twelve
  box(obj, 0.06, 0.9, 0.08, M.darkMetal, R.front + 0.17, 19.6, 0);
  box(obj, 1.05, 0.16, 3.8, M.plasterWhite, R.front + 0.52, 21.85, 0); // ledge
  box(obj, 0.04, 1.45, 2.7, M.darkMetal, R.front + 0.02, 22.0, 0); // the niche behind the doors
  // Turrets: corner ones 1.6 m square to 27.5 m, the middle one 2.6 m to 30 m, each with a slate helmet and a gold
  // finial
  for (const [w, s, h] of [[-fh + 0.8, 1.6, 3.0], [0, 2.6, 4.0], [fh - 0.8, 1.6, 3.0]]) {
    const y = R.atticTop;
    box(obj, s, h, s, M.plasterWhite, R.front - s / 2, y, w);
    box(obj, s + 0.3, 0.3, s + 0.3, M.plasterCream, R.front - s / 2, y + h - 0.3, w);
    const helmet = [[s * 0.62, 0], [s * 0.55, s * 0.5], [s * 0.25, s * 1.0], [0.08, s * 1.4], [0, s * 1.45]];
    lathe(obj, helmet, 8, M.slate, R.front - s / 2, y + h, w);
    cylinder(obj, 0.04, 0.04, 0.6, 4, M.gold, R.front - s / 2, y + h + s * 1.4, w);
  }

  // --- Tower (classicist, 1781–84, Solari): a square shaft rising through the roof with clocks on all four faces, an
  // octagonal belfry with a gallery, a bell helmet, an open lantern, a small dome, the spire and the crowned eagle
  const tu = R.towerU;
  const ts = R.towerHalf * 2;
  box(obj, ts, 36 - wallTop + 2, ts, M.plasterCream, tu, wallTop - 2, 0);
  for (const [du, dw] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const p = R.towerHalf - 0.2;
    box(obj, 0.7, 36 - wallTop - 1, 0.7, M.plasterWhite, tu + du * p, wallTop + 1, dw * p); // corner pilasters
  }
  box(obj, ts + 0.8, 0.7, ts + 0.8, M.plasterWhite, tu, 35.5, 0); // cornice
  for (const [axis, du, dw] of [['x', 1, 0], ['x', -1, 0], ['z', 0, 1], ['z', 0, -1]]) {
    const ox = tu + du * (R.towerHalf + 0.05);
    const oz = dw * (R.towerHalf + 0.05);
    disc(obj, 1.5, 0.2, M.plasterWhite, ox, 32, oz, axis, 20);
    disc(obj, 1.7, 0.12, M.gold, ox - du * 0.04, 32, oz - dw * 0.04, axis, 20);
    // tall belfry openings below the clock
    if (axis === 'x') box(obj, 0.06, 4.2, 1.6, M.glass, ox, 25.5, 0);
    else box(obj, 1.6, 4.2, 0.06, M.glass, tu, 25.5, oz);
  }
  cylinder(obj, 3.3, 3.3, 6, 8, M.plasterCream, tu, 36.2, 0); // belfry
  cylinder(obj, 3.9, 3.9, 0.3, 8, M.plasterWhite, tu, 36.2, 0); // gallery floor
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    box(obj, 0.12, 0.9, 2.9, M.plasterWhite, tu + Math.cos(a) * 3.55, 36.5, Math.sin(a) * 3.55, -a); // balustrade
    box(obj, 0.06, 3.4, 1.2, M.glass, tu + Math.cos(a) * 3.07, 37.6, Math.sin(a) * 3.07, -a);
  }
  cylinder(obj, 3.6, 3.6, 0.5, 8, M.plasterWhite, tu, 42.0, 0); // cornice
  lathe(obj, [[3.5, 0], [3.4, 0.6], [3.0, 1.7], [2.2, 2.9], [1.5, 3.7], [1.3, 4.3]], 16, M.slate, tu, 42.5, 0);
  cylinder(obj, 1.3, 1.3, 3.4, 8, M.plasterCream, tu, 46.8, 0); // lantern
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    box(obj, 0.05, 2.2, 0.6, M.glass, tu + Math.cos(a) * 1.25, 47.3, Math.sin(a) * 1.25, -a);
  }
  cylinder(obj, 1.6, 1.6, 0.3, 8, M.plasterWhite, tu, 50.2, 0);
  lathe(obj, [[1.55, 0], [1.4, 0.8], [0.9, 1.6], [0.4, 2.2], [0.22, 2.6]], 12, M.slate, tu, 50.5, 0);
  cylinder(obj, 0.06, 0.22, 5.5, 6, M.darkMetal, tu, 53.1, 0); // spire
  addMesh(obj, new THREE.SphereGeometry(0.4, 10, 8), M.gold, tu, 56.0, 0);
  cylinder(obj, 0.3, 0.12, 0.5, 6, M.gold, tu, 58.6, 0); // the eagle's perch
  // Eagle (white, crowned) facing east over the Rynek: body, head, spread wings raised in a V, tail
  const ey = 59.1;
  lathe(obj, [[0.05, 0], [0.32, 0.25], [0.38, 0.7], [0.3, 1.1], [0.14, 1.3]], 8, M.plasterWhite, tu, ey, 0);
  addMesh(obj, new THREE.SphereGeometry(0.2, 8, 6), M.plasterWhite, tu + 0.08, ey + 1.45, 0);
  for (const s of [-1, 1]) {
    const wing = box(obj, 0.08, 0.7, 1.05, M.plasterWhite, tu, ey + 0.55, s * 0.55);
    wing.rotation.x = -s * 0.5;
  }
  box(obj, 0.25, 0.35, 0.4, M.plasterWhite, tu - 0.15, ey - 0.15, 0); // tail
  cylinder(obj, 0.17, 0.14, 0.22, 8, M.gold, tu + 0.08, ey + 1.62, 0); // crown -> the top at ≈ 61 m with the eagle

  group.add(obj);

  // --- Koziołki (dynamic): two doors and two goats above the clock. They are fitted with the Ratusz (same fitToSite
  // call), then animated in their parents' local frame.
  const anim = new THREE.Group();
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(R.front + 0.06, 21.98, s * 1.35);
    box(hinge, 0.08, 1.4, 1.3, M.wood, 0, 0, -s * 0.65);
    anim.add(hinge);
    doors.push(hinge);
  }
  const goats = [];
  for (const s of [-1, 1]) {
    const g = buildGoat(M);
    g.side = s;
    g.goat.position.set(GOAT_U_IN, 22.01, s * GOAT_W_REST);
    g.goat.visible = false;
    anim.add(g.goat);
    goats.push(g);
  }
  dynamic.add(anim);

  // Colliders: the main block with its risalits, the stair bay and the loggia's side walls and back wall (its
  // ground-floor arcade stays walkable)
  collider(colliders, -17.2, 12.7, -9, 9, wallTop);
  collider(colliders, -6.2, 4.4, -10.4, 10.4, wallTop);
  collider(colliders, -18, -15.8, -9.7, -7.1, wallTop);
  collider(colliders, 12.7, R.front, -fh, -fh + 0.6, wallTop);
  collider(colliders, 12.7, R.front, fh - 0.6, fh, wallTop);
  // offset: the model's box runs u -18..19 (the goats' ledge), so its centre sits 0.5 m east of the local origin
  fitToSite([obj, anim], site('Ratusz'), colliders, c0, { height: 61, offset: [0.5, 0] });

  return createGoatShow(doors, goats);
}

// The noon show's per-frame driver: sets the doors' and goats' local transforms from the time into the current show;
// no allocation per frame
function createGoatShow(doors, goats) {
  const S = GOAT_SHOW;
  const tOpen = S.doorsOpen;
  const tOut = tOpen + S.slideOut;
  const tTurn = tOut + S.turnIn;
  const tButts = tTurn + S.butts * S.buttPeriod;
  const tTurnBack = tButts + S.turnOut;
  const tIn = tTurnBack + S.slideIn;
  const tClose = tIn + S.doorsClose;
  let wasMidday = false;
  let start = 0;
  let idle = false;

  const pose = (door, slide, turn, wOff, rear, visible) => {
    // the doors hinge at their outer edges and swing out over the ledge
    for (let i = 0; i < 2; i++) doors[i].rotation.y = (doors[i].position.z < 0 ? 1 : -1) * door * Math.PI / 2;
    for (let i = 0; i < goats.length; i++) {
      const g = goats[i];
      g.goat.visible = visible;
      g.goat.position.x = GOAT_U_IN + (GOAT_U_OUT - GOAT_U_IN) * slide;
      g.goat.position.z = g.side * wOff;
      g.goat.rotation.y = g.side * turn * Math.PI / 2; // -1 side turns to face +w, +1 to face -w
      g.rear.rotation.z = rear;
    }
  };

  return (dt, elapsed, presetId) => {
    const midday = presetId === 'midday';
    if (midday && !wasMidday) start = elapsed;
    wasMidday = midday;
    const t = midday ? (elapsed - start) % SHOW_PERIOD : tClose;
    if (t >= tClose) {
      if (!idle) pose(0, 0, 0, GOAT_W_REST, 0, false);
      idle = true;
      return;
    }
    idle = false;
    if (t < tOpen) pose(smooth(t / tOpen), 0, 0, GOAT_W_REST, 0, false);
    else if (t < tOut) pose(1, smooth((t - tOpen) / S.slideOut), 0, GOAT_W_REST, 0, true);
    else if (t < tTurn) pose(1, 1, smooth((t - tOut) / S.turnIn), GOAT_W_REST, 0, true);
    else if (t < tButts) {
      const p = ((t - tTurn) % S.buttPeriod) / S.buttPeriod;
      // ease into the first rear-up from the resting distance; afterwards rear back (70 %) and lunge (30 %)
      const back = p < 0.7 ? smooth(p / 0.7) : 1 - (p - 0.7) / 0.3;
      const near = t - tTurn < S.buttPeriod * 0.7 ? GOAT_W_REST : GOAT_W_HIT;
      const w = near + (GOAT_W_BACK - near) * back;
      pose(1, 1, 1, w, GOAT_REAR * back, true);
    } else if (t < tTurnBack) pose(1, 1, 1 - smooth((t - tButts) / S.turnOut), GOAT_W_REST, 0, true);
    else if (t < tIn) pose(1, 1 - smooth((t - tTurnBack) / S.slideIn), 0, GOAT_W_REST, 0, true);
    else pose(1 - smooth((t - tIn) / S.doorsClose), 0, 0, GOAT_W_REST, 0, false);
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Domki Budnicze: OSM site 8.1 × 52.7 m along w (≈ south) just south of the Ratusz, arcades facing east (+u, the
// Ratusz loggia side). pl.wikipedia "Domki budnicze w Poznaniu": narrow three- or four-storey houses with one- or
// two-window fronts and painted façades (Bednarowicz, 1953–61), rebuilt with arcades after 1945. Eleven houses here.
// -------------------------------------------------------------------------------------------------------------------
function buildDomkiBudnicze({ group, colliders, M }, pastels) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const [mint, sky, lilac] = pastels;
  const walls = [
    M.plasterPink, mint, M.plasterOchre, sky, M.plasterCream, lilac,
    M.plasterPink, M.plasterWhite, mint, M.plasterOchre, sky
  ];
  const widths = [5.0, 4.0, 4.6, 4.2, 5.2, 4.0, 4.8, 4.4, 4.6, 5.0, 5.4];
  const storeys = [4, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4];
  const houses = widths.map((width, i) => ({ width, storeys: storeys[i], wall: walls[i] }));
  const length = widths.reduce((a, b) => a + b, 0);
  const depth = 7.6;
  const { top } = buildArcadedHouseRow(obj, M, { houses, depth, z0: -length / 2 });
  group.add(obj);
  // The rooms behind the arcade (the arcade itself stays walkable)
  collider(colliders, -depth / 2, depth / 2 - 2.4, -length / 2, length / 2, 9);
  fitToSite([obj], site('Domki Budnicze'), colliders, c0, { height: top });
}

// -------------------------------------------------------------------------------------------------------------------
// Wieża Wójtowska (Stary Rynek 48): the stump of the Gothic brick bailiff's tower (late 13th century) built into a
// kamienica. Modelled modestly: a three-storey plastered house (12 m eaves, OSM 3 levels) and at its west end the
// brick tower with blind pointed-arch niches, slit windows and a steep tiled pyramid, rising a few metres over the
// house ridge. OSM site 23.6 × 7.7 m, local x = u ≈ east.
// -------------------------------------------------------------------------------------------------------------------
function buildWiezaWojtowska({ group, colliders, M }) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const d = 7.6;
  // House: u -4.2..11.7
  box(obj, 15.9, 12, d, M.facade.plasterOchre, 3.75, 0, 0);
  box(obj, 16.1, 0.35, d + 0.3, M.plasterWhite, 3.75, 11.8, 0);
  pitchedRoof(obj, 16.1, d + 0.4, 3.8, M.tileRed, 3.75, 12.1, 0, { ridge: 'x' });
  // Tower: u -11.8..-4.2, brick to 16 m with a corbelled top
  const tc = -8;
  const tw = 7.6;
  box(obj, tw, 16, d, M.brick, tc, 0, 0);
  box(obj, tw + 0.4, 0.5, d + 0.4, M.clinker, tc, 15.5, 0);
  for (const s of [-1, 1]) {
    for (const du of [-2, 0, 2]) {
      profileSlab(obj, pointedArchOutline(1.4, 5.0), 0.12, M.clinker, tc + du, 9.3, s * (d / 2 + 0.03));
      box(obj, 0.35, 1.4, 0.06, M.glass, tc + du, 12.0, s * (d / 2 + 0.1));
    }
    profileSlab(obj, pointedArchOutline(2.2, 3.6), 0.12, M.clinker, tc, 0, s * (d / 2 + 0.03)); // portal
    box(obj, 1.6, 2.6, 0.06, M.wood, tc, 0, s * (d / 2 + 0.1));
  }
  for (const du of [-2, 2]) box(obj, 0.06, 1.4, 0.35, M.glass, tc - tw / 2 - 0.03, 12.0, du); // west slits
  pitchedRoof(obj, tw + 0.5, d + 0.5, 4.5, M.tileRed, tc, 16, 0, { ridge: 'x', hip: 1 });
  group.add(obj);
  collider(colliders, -11.8, 11.7, -d / 2, d / 2, 12);
  fitToSite([obj], site('Wieża Wójtowska'), colliders, c0, { height: 20.5 });
}

function buildRynekLandmarks(ctx) {
  // Three façade pastels for the Domki Budnicze (the shared plasters give pink, ochre, cream and white): mint, pale
  // blue and lilac, from the post-1953 polychromy
  const std = (color) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.84 });
  const pastels = [std(0xb8d4b0), std(0xa9c4d8), std(0xc8b4d0)];
  const update = buildRatusz(ctx);
  buildDomkiBudnicze(ctx, pastels);
  buildWiezaWojtowska(ctx);
  return update;
}

export { buildRynekLandmarks, buildArcadedHouseRow };
