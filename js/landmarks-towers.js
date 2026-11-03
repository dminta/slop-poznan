import * as THREE from 'three/webgpu';
import { fitToSite, box, cylinder, prism, profileSlab, collider, site } from './landmark-kit.js';

// js/landmarks-towers.js
// Poznań's post-war and contemporary high-rises: MVRDV's Bałtyk at Rondo Kaponiera, the Collegium Altum of the
// Uniwersytet Ekonomiczny, the Plac Andersa cluster (Andersia Tower, AND2, Poznań Financial Centre, Novotel), Nowy
// Rynek E on Wierzbięcice and the 1970s Delta office block on Towarowa.
//
// Plans come from the OpenStreetMap building and building:part outlines (way ids in the comments), transformed into
// each site's local frame (local x = site u, local z = site w), so the masses stand where they really are on the lot.
// Those sites are modelled at real size and fitted with `horizontal: 1` and an `offset` that puts the model's box
// centre back where it sits inside the outline's box (fitToSite centres the model's box on the site centre).

// The local box centre of a group's parts, as fitToSite measures it: the `offset` that keeps a model drawn in the
// site's own (u, w) frame where it was drawn
function frameOffset(obj) {
  obj.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
  return [c.x, c.z];
}

// -------------------------------------------------------------------------------------------------------------------
// Bałtyk (MVRDV with Natkaniec Ruczkowski, 2017): 16 office storeys + a roof restaurant, 67 m, 3.94 m a level over the
// 17 levels OSM tags. The floors are offset diagonally, so the tower reads differently from every side: a broad
// staircase of terraces descending south-west to 5 storeys at the southern tip, a smaller staircase down to 11 storeys at
// the north-west tip, and towards Rondo Kaponiera (north-east) inverted stairs: the full-height corner is cut away from
// below by 2–8 levels, so the building leans out over the roundabout. Dark glass-fibre concrete with a tight grid of
// small windows. Each row is [top level, bottom level, plan [x, z]]: the building:part ways 1266226545–1266226584 of
// way 490881244, mapped into the site frame (local +x faces ESE, +z SSW; the roundabout is at -z / +x).
// -------------------------------------------------------------------------------------------------------------------
const BALTYK_LEVEL = 67 / 17;
const BALTYK_PARTS = [
  // The full-height core
  [17, 0, [[-12.2, -14.1], [-0.6, -32.6], [6.6, -12.8], [-12.1, 2.1]]],
  // North-west staircase down to the northern tip
  [16, 0, [[-2.5, -33.7], [-0.6, -32.6], [-12.2, -14.1], [-12.2, -18.1]]],
  [15, 0, [[-4.3, -34.7], [-2.5, -33.7], [-12.2, -18.1], [-12.2, -22.2]]],
  [14, 0, [[-6.2, -35.8], [-4.3, -34.7], [-12.2, -22.2], [-12.2, -26.2]]],
  [13, 0, [[-8.0, -36.8], [-6.2, -35.8], [-12.2, -26.2], [-12.2, -30.4]]],
  [12, 0, [[-10.0, -37.9], [-8.0, -36.8], [-12.2, -30.4], [-12.2, -34.5]]],
  [11, 0, [[-12.2, -38.5], [-11.7, -38.9], [-10.0, -37.9], [-12.2, -34.5]]],
  // South-west staircase: diagonal terraces 4 m deep, 16 → 5 levels
  [16, 0, [[-12.1, 2.1], [6.6, -12.8], [7.7, -9.7], [-12.1, 6.2]]],
  [15, 0, [[-12.1, 6.2], [7.7, -9.7], [8.9, -6.3], [-11.2, 9.8]]],
  [14, 0, [[-11.2, 9.8], [8.9, -6.3], [10.0, -3.1], [-10.4, 13.1]]],
  [13, 0, [[-10.4, 13.1], [10.0, -3.1], [11.3, 0.3], [-9.4, 16.6]]],
  [12, 0, [[-8.6, 19.9], [-9.4, 16.6], [11.3, 0.3], [12.4, 3.6]]],
  [11, 0, [[-8.6, 19.9], [12.4, 3.6], [12.4, 7.9], [-7.6, 23.9]]],
  [10, 0, [[-7.6, 23.9], [12.4, 7.9], [12.4, 12.2], [-6.7, 27.3]]],
  [9, 0, [[-6.7, 27.3], [12.4, 12.2], [12.4, 16.4], [-5.9, 30.7]]],
  [8, 0, [[-5.9, 30.7], [12.4, 16.4], [12.4, 20.8], [-5.0, 34.2]]],
  [7, 0, [[-5.0, 34.2], [12.4, 20.8], [12.4, 25.0], [1.4, 33.4], [-8.5, 36.1], [-12.4, 20.9], [-8.6, 19.9]]],
  [6, 0, [[-4.0, 38.0], [-7.8, 38.9], [-8.5, 36.1], [1.4, 33.4], [12.4, 25.0], [12.4, 29.4], [4.3, 35.8]]],
  [5, 0, [[4.3, 35.8], [12.4, 29.4], [12.4, 33.6]]],
  // North-east corner over the roundabout: full height, cut away from below by 2 → 8 levels towards the corner
  [17, 2, [[1.3, -31.5], [7.7, -13.7], [6.6, -12.8], [-0.6, -32.6]]],
  [17, 3, [[3.3, -30.3], [9.0, -14.7], [7.7, -13.7], [1.3, -31.5]]],
  [17, 4, [[5.2, -29.2], [10.1, -15.6], [9.0, -14.7], [3.3, -30.3]]],
  [17, 5, [[7.1, -28.1], [11.3, -16.5], [10.1, -15.6], [5.2, -29.2]]],
  [17, 6, [[9.0, -27.1], [12.4, -17.4], [11.3, -16.5], [7.1, -28.1]]],
  [17, 7, [[10.9, -26.0], [12.4, -21.8], [12.4, -17.4], [9.0, -27.1]]],
  [17, 8, [[10.9, -26.0], [12.4, -21.8], [12.4, -25.1]]],
  // East side, between the corner and the south staircase: stepped both from above and below
  [16, 2, [[7.7, -13.7], [8.8, -10.7], [7.7, -9.7], [6.6, -12.8]]],
  [16, 3, [[9.0, -14.7], [10.0, -11.7], [8.8, -10.7], [7.7, -13.7]]],
  [16, 4, [[10.1, -15.6], [11.2, -12.6], [10.0, -11.7], [9.0, -14.7]]],
  [16, 5, [[11.3, -16.5], [12.4, -13.6], [11.2, -12.6], [10.1, -15.6]]],
  [16, 6, [[12.4, -17.4], [12.4, -13.6], [11.3, -16.5]]],
  [15, 2, [[8.8, -10.7], [10.0, -7.3], [8.9, -6.3], [7.7, -9.7]]],
  [15, 3, [[10.0, -11.7], [11.3, -8.2], [10.0, -7.3], [8.8, -10.7]]],
  [15, 4, [[11.2, -12.6], [12.4, -9.2], [11.3, -8.2], [10.0, -11.7]]],
  [15, 5, [[12.4, -13.6], [12.4, -9.2], [11.2, -12.6]]],
  [14, 2, [[10.0, -7.3], [11.2, -4.1], [10.0, -3.2], [8.9, -6.3]]],
  [14, 3, [[11.3, -8.2], [12.4, -5.1], [11.2, -4.1], [10.0, -7.3]]],
  [14, 4, [[12.4, -9.2], [12.4, -5.1], [11.3, -8.2]]],
  [13, 2, [[12.4, -0.6], [11.2, -4.1], [10.0, -3.2], [11.3, 0.3]]],
  [13, 3, [[12.4, -5.1], [12.4, -0.6], [11.2, -4.1]]],
  [12, 2, [[11.3, 0.3], [12.4, -0.6], [12.4, 3.6]]]
];

function buildBaltyk(obj, M) {
  const L = BALTYK_LEVEL;
  for (const [top, bottom, plan] of BALTYK_PARTS) {
    const y0 = bottom * L;
    const y1 = top * L;
    // Glazed walls (the curtain shader's world-space grid of small windows), a dark terrace deck / roof slab on top
    // and, where the floor is cut away from below, a dark soffit under the overhang
    prism(obj, plan, y1 - y0 - 0.45, M.facade.glassDark, 0, y0, 0);
    prism(obj, plan, 0.45, M.granite, 0, y1 - 0.45, 0);
    if (bottom > 0) prism(obj, plan, 0.6, M.darkMetal, 0, y0, 0);
  }
  // Terrace balustrades: a glass band 1.1 m tall along the low edge of each south-west terrace (its longest edge
  // facing down the stairs, +x +z)
  for (let i = 7; i < 18; i++) {
    const [top, , plan] = BALTYK_PARTS[i];
    let best = null;
    let bestDot = -Infinity;
    for (let k = 0; k < plan.length; k++) {
      const a = plan[k];
      const b = plan[(k + 1) % plan.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 6) continue;
      const dot = (a[0] + b[0]) * 0.62 + (a[1] + b[1]) * 0.78;
      if (dot > bestDot) {
        bestDot = dot;
        best = [a, b];
      }
    }
    railing(obj, best[0], best[1], top * L, M.glass);
  }
}

// A thin glass balustrade from a to b ([x, z]) standing at y
function railing(obj, a, b, y, material) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  box(obj, len, 1.1, 0.08, material, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, -Math.atan2(dz, dx));
}

// Vertical fins every `step` m along the wall line a → b ([x, z]), w thick and d deep, centred on the line (half buried
// in the wall), standing from y for h: the louvres and mullion fins of the curtain walls
function finRow(obj, a, b, y, h, step, w, d, material) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / step));
  const ry = -Math.atan2(dz, dx);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    box(obj, w, h, d, material, a[0] + dx * t, y, a[1] + dz * t, ry);
  }
}

// A plan ([x, z] points) pushed out by about k metres from its vertex centroid: spandrel bands proud of the glazing
function inflate(plan, k) {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of plan) {
    cx += x / plan.length;
    cz += z / plan.length;
  }
  return plan.map(([x, z]) => {
    const r = Math.hypot(x - cx, z - cz) || 1;
    return [x + ((x - cx) / r) * k, z + ((z - cz) / r) * k];
  });
}

function buildTowerLandmarks({ group, colliders, M }) {
  // ---------------------------------------------------------------------------------------------------------------
  // Bałtyk, 67 m (pl.wikipedia, MVRDV): see BALTYK_PARTS
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    buildBaltyk(obj, M);
    group.add(obj);
    // The levels that reach the ground: core, both staircases (the overhangs over the roundabout stay walkable)
    collider(colliders, -12.2, -1, -36, 6, 67);
    collider(colliders, -1, 6.6, -32, 0, 67);
    collider(colliders, -9, 12.4, 0, 33, 40);
    collider(colliders, 6.6, 12.4, -10, 0, 50);
    collider(colliders, -8, 6, 33, 38.5, 20);
    fitToSite([obj], site('Bałtyk'), colliders, c0, { height: 67, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Collegium Altum (Uniwersytet Ekonomiczny, 1977–1991): a 4-storey, 16 m library and lecture podium filling the whole
  // lot, and on its north-east half a ~30 × 29 m teaching tower of 19 storeys to 67.7 m: ribbon windows between 1.7 m
  // bands of red metal panels (pl.wikipedia), a 10.75 m solid crown of plant floors to 78.45 m and the 25 m antenna mast
  // (lifted in by helicopter in 1983) to 103.35 m. Heights and the band levels are the building:part ways 239809212–
  // 239809228 (height / min_height); local -z faces NNE (Niezłomnych), +x ESE (Powstańców Wielkopolskich).
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    // Podium: a box under the tower half and the bevelled west half cut on the diagonal
    box(obj, 28.9, 16, 45.6, M.facade.concrete, 14.2, 0, 0.4);
    prism(obj, [[0, -22.1], [-17.5, -21.8], [-19.5, -20.4], [-21.6, -23.2], [-25.4, -20.3], [-23.4, -17.5],
      [-28.8, -13.5], [-1.6, 23.2], [0, 23.2]], 16, M.facade.concrete, 0, 0, 0);
    box(obj, 29, 0.6, 46, M.concrete, 14.2, 16, 0.4);
    // The library's skylight lanterns on the podium roof (16 → 20 m), two grids: square to the podium edges in the
    // east half, turned 55° along the diagonal wing in the west
    const LANTERNS = [[-1, 21.9], [11.3, 15.8], [-10.55, -5.75], [-4.55, -11.5], [23.5, 21.8], [23.5, 9.65],
      [-4.75, -5.55], [-10.45, -11.7], [11.1, 21.95], [17.4, 15.75], [17.3, 9.55], [23.5, 15.7], [5.1, 9.5],
      [5.1, 21.95], [17.3, 21.85], [11.25, 9.5]];
    for (const [x, z] of LANTERNS) {
      box(obj, 5, 3.2, 5.3, M.concrete, x, 16, z);
      box(obj, 4.4, 0.8, 4.7, M.glass, x, 19.2, z);
    }
    const TURNED_LANTERNS = [[-13.6, 15.65], [-8.6, 12.15], [-17.2, 11.05], [-19.3, -2.15], [-24.3, 1.45], [-15.8, 2.75],
      [-12.2, 7.45], [-22.65, -6.85], [-20.8, 6.35]];
    for (const [x, z] of TURNED_LANTERNS) {
      box(obj, 4.9, 3.2, 5.4, M.concrete, x, 16, z, -0.96);
      box(obj, 4.3, 0.8, 4.8, M.glass, x, 19.2, z, -0.96);
    }
    // Tower: dark ribbon glazing, the red panel bands every 3.4 m, then the solid crown
    const TX = 14.6;
    const TZ = -9.1;
    box(obj, 29.6, 51.7, 28.6, M.glass, TX, 16, TZ);
    for (let y = 20; y < 66; y += 3.42) box(obj, 30.1, 1.7, 29.1, M.brick, TX, y, TZ);
    box(obj, 30.1, 1.7, 29.1, M.brick, TX, 16, TZ);
    box(obj, 30.1, 10.75, 29.1, M.brick, TX, 67.7, TZ);
    // Corner piers in the red cladding, chamfered in plan on the real tower
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box(obj, 1.6, 62.45, 1.6, M.brick, TX + sx * 14.3, 16, TZ + sz * 13.8, Math.PI / 4);
    }
    // The crown's dark louvre band and the antenna mast on its roof, off-centre where the OSM node puts it
    box(obj, 30.3, 2.4, 29.3, M.darkMetal, TX, 72.5, TZ);
    cylinder(obj, 1.4, 1.6, 3, 8, M.steel, 14.7, 78.45, -9);
    cylinder(obj, 0.25, 0.9, 21.9, 6, M.steel, 14.7, 81.45, -9);
    group.add(obj);
    collider(colliders, 0, 28.6, -22.4, 23.2, 16);
    collider(colliders, -24, 0, -21, 8, 16);
    collider(colliders, -0.2, 29.4, -23.4, 5, 78.45);
    fitToSite([obj], site('Collegium Altum'), colliders, c0, { height: 103.35, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Andersia Tower (Sipiński, 2007): a 53 × 30 m blue-glass slab of 21 storeys (the IBB Andersia hotel below, offices
  // above), 84 m to the roof and 102.1 m with its crown (pl.wikipedia; building:part way 436542397 gives the slab's
  // plan and the 84 m). The crown is a slanted glass screen rising towards Plac Andersa's corner, with a mast at its
  // peak. The SSW half of the lot is the low conference / banquet wing (3 storeys, estimated). Local -z faces NNE.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    box(obj, 46.5, 84, 29.7, M.facade.glassBlue, 3.35, 0, -16.45);
    box(obj, 3.8, 80.2, 18.8, M.facade.glassBlue, -21.7, 0, -11);
    box(obj, 2.9, 14, 3.9, M.facade.glassBlue, 27.95, 0, -3.55);
    // Mullion fins on the long faces and light stone piers at the slab's four corners
    finRow(obj, [-19.9, -31.3], [26.6, -31.3], 0, 84, 3.1, 0.25, 0.7, M.steel);
    finRow(obj, [-19.9, -1.6], [26.6, -1.6], 14, 70, 3.1, 0.25, 0.7, M.steel);
    for (const x of [-20.2, 26.9]) {
      for (const z of [-30.9, -2]) box(obj, 1.8, 84.6, 1.8, M.stoneGrey, x, 0, z);
    }
    // Low wing: hotel conference centre and the arcade along the square
    box(obj, 58.8, 14, 31.2, M.facade.glassBlue, 0, 0, 14.0);
    box(obj, 26.7, 14, 1.8, M.facade.glassBlue, -14.9, 0, 30.4);
    box(obj, 59.4, 0.8, 31.8, M.stoneGrey, 0, 14, 14.0);
    // Crown: a glass screen over the plant floors, sloping up from 88 m at the west end to 98 m at the east, and the mast
    box(obj, 44, 4, 27, M.darkMetal, 3.35, 84, -16.45);
    profileSlab(obj, [[-19.9, 84], [26.6, 84], [26.6, 98], [-19.9, 88]], 29.7, M.facade.glassBlue, 0, 0, -16.45);
    profileSlab(obj, [[-20.4, 84], [27.1, 84], [27.1, 98.4], [-20.4, 88.4], [-20.4, 87.6], [26.1, 97.4], [26.1, 84.6]],
      30.3, M.steel, 0, 0, -16.45);
    cylinder(obj, 0.15, 0.5, 4.1, 6, M.steel, 24.6, 98, -16.45);
    group.add(obj);
    collider(colliders, -23.6, 29.4, -31.3, -1.6, 84);
    collider(colliders, -29.4, 29.4, -1.6, 31.3, 14);
    fitToSite([obj], site('Andersia'), colliders, c0, { height: 102.1, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // AND2 (Andersia Silver, Sipiński, topped out 2023, opened 2025): Poznań's tallest building, 26 storeys and 116 m
  // (OSM height, the developer's figure). Two interlocking silver-glass volumes, as the outline's two cut corners
  // suggest: the longer SSW block runs to the full height under a crown screen, the NNE block stops four storeys lower.
  // Local -z faces NNE (towards Andersia's square), +x ESE.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    box(obj, 35.3, 106, 59.8, M.facade.glassBlue, -1.95, 0, 3.9);
    box(obj, 27.2, 92, 37.6, M.facade.glassBlue, 6.0, 0, -14.9);
    // Ground-floor double-height lobby set back under the slab, steel fins up every face
    finRow(obj, [-19.6, 33.8], [15.7, 33.8], 0, 106, 3.0, 0.3, 0.8, M.steel);
    finRow(obj, [-19.6, -26], [-19.6, 33.8], 0, 106, 3.0, 0.3, 0.8, M.steel);
    finRow(obj, [15.7, 3.9], [15.7, 33.8], 0, 106, 3.0, 0.3, 0.8, M.steel);
    finRow(obj, [-7.6, -33.7], [19.6, -33.7], 0, 92, 3.0, 0.3, 0.8, M.steel);
    finRow(obj, [19.6, -33.7], [19.6, 3.9], 0, 92, 3.0, 0.3, 0.8, M.steel);
    // Terrace roof of the lower block, crown screen and plant on the tower roof
    box(obj, 27.6, 1.2, 38, M.steel, 6.0, 92, -14.9);
    box(obj, 35.8, 1.2, 60.3, M.steel, -1.95, 106, 3.9);
    box(obj, 34.8, 8.8, 59.3, M.facade.glassBlue, -1.95, 107.2, 3.9);
    box(obj, 35.6, 0.6, 60.1, M.steel, -1.95, 115.4, 3.9);
    group.add(obj);
    collider(colliders, -19.6, 15.7, -26, 33.8, 106);
    collider(colliders, -7.6, 19.6, -33.7, 3.9, 92);
    fitToSite([obj], site('AND2'), colliders, c0, { height: 116, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Poznań Financial Centre (Poznańskie Centrum Finansowe, 2001): a 20-storey green-glass office tower, 91 m with its
  // crown (pl.wikipedia), on the NNE half of the lot, its ESE end a curved glass prow (building:part way 436556639;
  // its last 6 m past the main outline is cut back here). The SSW half is a lower office wing (12 storeys, estimated).
  // The crown: two set-back plant storeys and a barrel-vaulted glass crest along the tower. Local -z faces NNE.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const TOWER = [[-6.1, -2.9], [-6.1, 1.0], [17.0, 1.2], [21.9, 0.7], [27.2, -0.3], [31.4, -1.9], [31.4, -25.2],
      [-5.9, -25.2], [-5.9, -18.8], [-15.1, -18.8], [-15.2, -9.4], [-5.9, -9.4]];
    prism(obj, TOWER, 76, M.facade.glassGreen, 0, 0, 0);
    prism(obj, inflate(TOWER, 0.3), 1.0, M.steel, 0, 76, 0);
    // Rear wing: three axis-aligned blocks following the main outline south of the tower
    box(obj, 50.3, 44, 21.4, M.facade.glassGreen, 3.9, 0, 12.7);
    box(obj, 23.1, 44, 6, M.facade.glassGreen, -17.65, 0, 0);
    box(obj, 27.6, 44, 3, M.facade.glassGreen, 7.8, 0, 22.4);
    box(obj, 58.4, 0.8, 27, M.steel, 0, 44, 10.5);
    // Set-back plant storeys, then the crest: a barrel vault in plan along x, 24 m across, springing at 85 m
    box(obj, 32, 9, 20, M.facade.glassGreen, 8, 77, -12.2);
    const arc = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      arc.push([Math.cos(t) * 12.5, 86 + Math.sin(t) * 5]);
    }
    profileSlab(obj, arc, 30, M.facade.glassGreen, 8, 0, -12.2, Math.PI / 2);
    box(obj, 32.6, 0.8, 26.2, M.steel, 8, 85.4, -12.2);
    finRow(obj, [-5.9, -25.2], [31.4, -25.2], 0, 76, 3.4, 0.25, 0.6, M.steel);
    group.add(obj);
    collider(colliders, -15.2, 31.4, -25.2, 1, 76);
    collider(colliders, -29.2, 29, -3, 24, 44);
    fitToSite([obj], site('Poznań Financial Centre'), colliders, c0,
      { height: 91, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Novotel Poznań Centrum (the 1974 Hotel Poznań, large-panel concrete): a pinwheel tower of four ~16 m wings round a
  // core, 16 storeys, 68 m to the top of its plant floor (building:part way 36456643, pl.wikipedia), standing in the
  // SSW part of a lot whose NNE two-thirds is the 2-storey podium and car park deck in front of the hotel. The wings are
  // modelled as boxes so the windows line up in whole bays. Local -z faces NNE, +x ESE.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const H = 64;
    const WINGS = [
      [4.3, 21.5, -8.7, 14.2], // NNE wing
      [-21.8, 0.4, 8.6, 25.5], // WNW wing
      [0.4, 16.7, 12.7, 29.2], // core
      [14.6, 35.2, 18.4, 34.0], // ESE wing
      [-4.9, 11.0, 29.2, 49.5] // SSW wing
    ];
    for (const [x0, x1, z0, z1] of WINGS) {
      box(obj, x1 - x0, H, z1 - z0, M.facade.concrete, (x0 + x1) / 2, 0, (z0 + z1) / 2);
      box(obj, x1 - x0 + 0.6, 0.8, z1 - z0 + 0.6, M.concrete, (x0 + x1) / 2, H, (z0 + z1) / 2);
    }
    // The plant storey on the core, and the stair shafts at the wing ends in bare concrete
    box(obj, 14, 4, 14, M.concrete, 8.5, H, 21);
    box(obj, 2.4, H + 1.2, 6, M.concrete, 35.6, 0, 26);
    box(obj, 6, H + 1.2, 2.4, M.concrete, 3, 0, 50.1);
    box(obj, 2.4, H + 1.2, 6, M.concrete, -22.3, 0, 13);
    box(obj, 6, H + 1.2, 2.4, M.concrete, 17.8, 0, -9.2);
    // Podium: hotel lobby, restaurant and the car park deck to the NNE, glazed under a concrete fascia
    box(obj, 64.2, 8, 59, M.facade.concrete, -4, 0, -21);
    box(obj, 15.2, 8, 13, M.facade.concrete, -28.5, 0, 16);
    box(obj, 64.8, 1.2, 59.6, M.concrete, -4, 8, -21);
    box(obj, 6.2, 8, 9.4, M.facade.concrete, 31.2, 0, 22.6);
    group.add(obj);
    collider(colliders, -36.1, 28.1, -50.5, 8.6, 9.2);
    collider(colliders, -36.1, -21, 8.6, 29.5, 8);
    collider(colliders, -21.8, 21.5, -8.7, 29.2, H);
    collider(colliders, 14.6, 36.1, 18.4, 34, H);
    collider(colliders, -4.9, 11, 29.2, 50.5, H);
    fitToSite([obj], site('Novotel'), colliders, c0, { height: 68, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Nowy Rynek E (Skanska, 2023, corner of Wierzbięcice and Matyi): 16 storeys, 66 m (pl list of tallest buildings;
  // OSM way 917582170, levels 16, flat roof). A green-glass office block whose whole skin is close-set light vertical
  // fins (the 2.7 m teeth along the OSM outline), its top floor a partly roofed terrace screened by a 3-storey frame.
  // Plan: a 46.6 m quadrilateral with the SSW side running on the diagonal; local -z faces N.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const H = 66;
    box(obj, 46.4, H - 12, 45.6, M.facade.glassGreen, -0.1, 0, -5.4);
    prism(obj, [[-23.3, 17.4], [22.0, 17.4], [-23.3, 29.4]], H - 12, M.facade.glassGreen, 0, 0, 0);
    // Top three storeys: glazed on the N and E half, an open terrace on the SW under the frame's roof
    box(obj, 46.4, 8.4, 26, M.facade.glassGreen, -0.1, H - 12, -15.2);
    box(obj, 20, 8.4, 20, M.facade.glassGreen, 13, H - 12, 7);
    box(obj, 46.8, 0.8, 46, M.plasterWhite, -0.1, H - 3.6, -5.4);
    box(obj, 46.8, 2.8, 46, M.plasterWhite, -0.1, H - 2.8, -5.4);
    for (const [x, z] of [[-23, 17.2], [-23, 0], [0, 17.2], [-11.5, 17.2]]) {
      box(obj, 0.8, 9.2, 0.8, M.plasterWhite, x, H - 12, z);
    }
    // The fins, every 2.7 m, full height on every face
    const OUTLINE = [[-23.3, -28.4], [23.3, -29.2], [21.8, 17.4], [-23.3, 29.4]];
    for (let i = 0; i < 4; i++) finRow(obj, OUTLINE[i], OUTLINE[(i + 1) % 4], 0, H, 2.7, 0.35, 0.9, M.plasterWhite);
    group.add(obj);
    collider(colliders, -23.3, 23.3, -29.2, 17.4, H);
    collider(colliders, -23.3, 8, 17.4, 25, H - 12);
    fitToSite([obj], site('Nowy Rynek'), colliders, c0, { height: H, horizontal: 1, offset: frameOffset(obj) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Delta (Towarowa 35, 2004, Pracownia Architektoniczna Ewy i Stanisława Sipińskich, Ataner): a triangle in plan,
  // ~66 m along its NNW face, 11 storeys in the high part (10 office ribbon levels + roof plant, dominanta 43.5 m)
  // and 6 storeys in the lower wing (OSM ways 1095436555–6), with two stair towers proud of the NNW face.
  // Local +x faces NE, +z SE.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const F = 3.95;
    const TRI = [[-1, 4.3], [-17.8, -13.9], [-18.5, -14.8], [-12.9, -14.7], [-9.1, -14.8], [48.5, -14.7], [47.8, -14.1],
      [12, 18.7], [2.9, 8.8]];
    const WING = [[-17.8, -13.9], [-30.9, -13.4], [-43.7, -18.7], [-48.5, -8.3], [-7.5, 10.2], [-1, 4.3]];
    const ribbons = (plan, floors) => {
      const proud = inflate(plan, 0.25);
      prism(obj, plan, floors * F, M.glass, 0, 0, 0);
      prism(obj, proud, 1.2, M.concrete, 0, 0, 0);
      for (let f = 1; f <= floors; f++) prism(obj, proud, 1.3, M.concrete, 0, f * F - 0.4, 0);
    };
    ribbons(TRI, 10);
    ribbons(WING, 6);
    // The stair towers in bare concrete, and the plant storey on the roof
    prism(obj, [[9, -14.7], [12.8, -17.9], [15.8, -14.6]], 10 * F + 1.6, M.concrete, 0, 0, 0);
    prism(obj, [[17.9, -14.6], [22.2, -18.7], [26, -14.7]], 10 * F + 1.6, M.concrete, 0, 0, 0);
    prism(obj, [[2, -11], [36, -11], [13, 8]], F + 0.4, M.facade.concrete, 0, 10 * F + 0.9, 0);
    group.add(obj);
    collider(colliders, -15, 40, -15, -5, 10 * F + 1);
    collider(colliders, 0, 25, -5, 8, 10 * F + 1);
    collider(colliders, -46, -10, -15, 0, 6 * F + 1);
    fitToSite([obj], site('Delta'), colliders, c0, { height: 43.5, horizontal: 1, offset: frameOffset(obj) });
  }
}

export { buildTowerLandmarks };
