import * as THREE from 'three/webgpu';
import { fitToSite, addMesh, box, cylinder, lathe, pitchedRoof, prism, profileSlab, collider, site } from './landmark-kit.js';

// js/landmarks-heritage.js
// The historic landmarks of Ostrów Tumski, the Old Town hill and Śródka: the Katedra, the Fara, the Zamek Królewski on
// Wzgórze Przemysła and the Brama Poznania ICHOT on the Cybina. Modelled in metres around a local origin (conventions
// in landmark-kit.js), each fitted onto its OpenStreetMap outline.

// Points of a half polygon about (cx, cz) bulging towards +x: `segs` sides from the -z to the +z side, at the same
// angles as a CylinderGeometry with thetaStart 0 and thetaLength π (x = r sin θ, z = r cos θ), so apse walls and
// their half-cone roofs share their corners
function halfPolygon(cx, cz, r, segs) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = Math.PI - (i * Math.PI) / segs;
    pts.push([cx + r * Math.sin(t), cz + r * Math.cos(t)]);
  }
  return pts;
}

// A half cone (apse roof) of radius r and height h over the half polygon above, standing on y
function halfCone(parent, r, h, segs, material, x, y, z) {
  const g = new THREE.CylinderGeometry(0, r, h, segs, 1, false, 0, Math.PI);
  return addMesh(parent, g, material, x, y + h / 2, z);
}

// A lean-to roof along x from x0 to x1: rises from the outer eaves at zOut to the wall at zIn, `rise` above y
function leanTo(parent, x0, x1, zIn, zOut, rise, material, y) {
  const outline = [[zOut, 0], [zIn, 0], [zIn, rise]];
  return profileSlab(parent, outline, x1 - x0, material, (x0 + x1) / 2, y, 0, -Math.PI / 2);
}

// A straight strut from (z0, y0) to (z1, y1) at x, rotated in the y-z plane: flying buttresses
function strut(parent, x, z0, y0, z1, y1, w, t, material) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const m = addMesh(parent, new THREE.BoxGeometry(w, t, len), material, x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
  return m;
}

// Katedra (Archikatedra św. Piotra i Pawła): 72 × 36 m with the chapels, twin west towers ≈ 62 m (pl.wikipedia: "ok.
// 62 m", the plan's §9.1). The outline's +u faces bearing 72°, so local -x is the west front and -z the north side.
// Nave ridge and wall heights are estimates from photographs (the brick nave stands about two-thirds of the towers'
// masonry; the baroque helmets are about a third of the total height).
const KATEDRA = {
  towerTop: 40, // brick tower shafts
  naveWall: 25,
  naveRidge: 37,
  aisleWall: 14,
  chapelWall: 9
};

function buildKatedra(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const K = KATEDRA;
  const brick = M.brick;
  const roof = M.clinker;

  // Nave (12 m wide) and choir straight bays, one high roof; clerestory lancets between the flyers
  box(obj, 50, K.naveWall, 12, brick, -3, 0, 0);
  pitchedRoof(obj, 51, 13, K.naveRidge - K.naveWall, roof, -3, K.naveWall, 0);
  // Aisles (6 m) with lean-to roofs against the clerestory
  for (const s of [-1, 1]) {
    box(obj, 50, K.aisleWall, 6, brick, -3, 0, s * 9);
    leanTo(obj, -28, 22, s * 6, s * 12.3, 4, roof, K.aisleWall);
    // Chapels between the aisle buttresses, under their own lean-to roofs
    box(obj, 38, K.chapelWall, 6.3, brick, -9, 0, s * 15.2);
    leanTo(obj, -28, 10, s * 12, s * 18.5, 2.6, roof, K.chapelWall);
  }

  // Polygonal high choir (5 sides) about (22, 0), its ambulatory and the pointed ring of chapels the outline traces
  prism(obj, halfPolygon(22, 0, 6, 5), K.naveWall, brick, 0, 0, 0);
  halfCone(obj, 6.5, K.naveRidge - K.naveWall, 5, roof, 22, K.naveWall, 0);
  prism(obj, halfPolygon(22, 0, 12, 7), K.aisleWall, brick, 0, 0, 0);
  halfCone(obj, 12.4, 5, 7, roof, 22, K.aisleWall, 0);
  const ring = [[10, -18.5], [12, -21], [20, -17], [28, -11.5], [34.5, -6], [37, 0], [34.5, 6], [28, 11.5], [20, 17],
    [12, 21], [10, 18.5]];
  prism(obj, ring, K.chapelWall, brick, 0, 0, 0);
  prism(obj, ring.map(([x, z]) => [x + (22 - x) * 0.12, z * 0.88]), 2.4, roof, 0, K.chapelWall, 0);
  // Złota Kaplica (the Golden Chapel), an octagon on the church's axis behind the choir, with a copper dome
  cylinder(obj, 3.6, 3.6, 12, 8, brick, 37, 0, 0);
  lathe(obj, [[3.9, 0], [3.7, 1.4], [3, 2.8], [1.8, 3.8], [0.6, 4.3], [0.3, 5.6], [0, 6.2]], 8, M.copper, 37, 12, 0);

  // Buttresses on the aisle walls and flying buttresses over the aisle roofs to the clerestory, one per 5 m bay
  for (let x = -25; x <= 20; x += 5) {
    for (const s of [-1, 1]) {
      if (x <= 8) box(obj, 1.2, K.aisleWall + 2.5, 1.4, brick, x, 0, s * 18.9);
      box(obj, 1.2, K.aisleWall + 4, 1.4, brick, x, 0, s * 12.4);
      strut(obj, x, s * 12.4, K.aisleWall + 3, s * 6.2, K.naveWall - 3, 0.8, 0.9, brick);
      // Clerestory lancet between this flyer and the next
      if (x < 20) box(obj, 2, 7, 0.3, M.glass, x + 2.5, K.aisleWall + 2.5, s * 6.05);
    }
  }
  for (let a = 0; a < 5; a++) {
    // Tall choir lancets on the apse faces
    const t = Math.PI - ((a + 0.5) * Math.PI) / 5;
    const r = 6 * Math.cos(Math.PI / 10) + 0.1; // the face's distance from the apse centre
    box(obj, 1.8, 9, 0.3, M.glass, 22 + r * Math.sin(t), K.aisleWall + 0.5, r * Math.cos(t), t);
  }

  // West front: the nave gable between the two towers, with the gothic portal and a tall west window
  box(obj, 3, K.naveWall, 10, brick, -29.5, 0, 0);
  profileSlab(obj, [[-6, 0], [6, 0], [0, K.naveRidge - K.naveWall + 1]], 2.6, brick, -29.5, K.naveWall, 0, Math.PI / 2);
  box(obj, 0.4, 8, 4, M.clinker, -31.1, 0, 0);
  box(obj, 0.3, 10, 3.2, M.glass, -31.1, 11, 0);

  // Twin west towers (11 m square), brick shafts with corner buttresses and belfry openings, then the baroque helmets:
  // a bell-shaped copper cap, an open lantern, a small onion and the needle with its cross
  for (const s of [-1, 1]) {
    const tz = s * 10.5;
    box(obj, 11, K.towerTop, 11, brick, -34, 0, tz);
    box(obj, 11.8, 1, 11.8, M.sandstone, -34, K.towerTop - 1, tz);
    for (const [bx, bz] of [[-39.2, tz - 5.2], [-39.2, tz + 5.2], [-28.8, tz + s * 5.2]]) {
      box(obj, 1.6, K.towerTop - 8, 1.6, brick, bx, 0, bz);
    }
    for (const [dx, dz, ry] of [[-5.6, 0, 0], [0, s * 5.6, Math.PI / 2], [0, -s * 5.6, Math.PI / 2]]) {
      for (const k of [-2.2, 2.2]) {
        const ox = ry ? k : 0;
        const oz = ry ? 0 : k;
        box(obj, ry ? 1.6 : 0.3, 6, ry ? 0.3 : 1.6, M.glass, -34 + dx + ox, 31, tz + dz + oz);
        box(obj, ry ? 1.4 : 0.3, 3.5, ry ? 0.3 : 1.4, M.glass, -34 + dx + ox, 21, tz + dz + oz);
      }
    }
    lathe(obj, [[5.9, 0], [5.6, 0.8], [4.6, 2.2], [3.2, 3.4], [2.4, 4.4], [2.3, 5]], 8, M.copper, -34, K.towerTop, tz);
    cylinder(obj, 1.9, 2.1, 3.2, 8, M.darkMetal, -34, K.towerTop + 5, tz);
    const spire = [[2.5, 0], [2.2, 0.6], [1.1, 1.3], [1.6, 2.4], [1.7, 3.2], [1.1, 4.2], [0.35, 5], [0.2, 6.4], [0, 13.6]];
    lathe(obj, spire, 8, M.copper, -34, K.towerTop + 8.2, tz);
    box(obj, 0.15, 1.4, 0.15, M.gold, -34, K.towerTop + 21.8, tz);
  }
  group.add(obj);

  collider(colliders, -39.5, -28.5, -16, 16, K.towerTop);
  collider(colliders, -28.5, 22, -12, 12, K.naveWall);
  collider(colliders, -28, 10, -18.5, 18.5, K.chapelWall);
  collider(colliders, 22, 34, -12, 12, K.aisleWall);
  collider(colliders, 10, 28, -21, 21, K.chapelWall);
  collider(colliders, 28, 40.6, -6, 6, 12);
  fitToSite([obj], site('Katedra'), colliders, c0, { height: 62 });
}

// Fara (Bazylika Kolegiacka MB Nieustającej Pomocy): the former Jesuit church, 55 m long with a 27 m high nave
// (en.wikipedia "Poznań Fara"); its baroque main front faces north, closing ul. Świętosławska from the Stary Rynek
// (outline +u faces bearing 98°, so -z is north). Ridge and front heights are estimates: a 27 m vault under a ≈ 13 m
// roof puts the ridge near 40 m, which the two-storey front with its pediment and statues reaches. No dome is modelled:
// none shows on the exterior.
const FARA = {
  naveWall: 29,
  ridge: 40,
  aisleWall: 17,
  frontLower: 17,
  frontUpper: 33
};

function buildFara(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const F = FARA;
  const wall = M.plasterPink;
  const trim = M.plasterWhite;

  // Nave (19 m) and the lower aisles of side chapels, under one tall roof and lean-tos, hipped at the south (rear) end
  box(obj, 19, F.naveWall, 54, wall, 0, 0, 1.5);
  box(obj, 19.8, 1.2, 54.4, trim, 0, F.naveWall - 1.2, 1.5);
  pitchedRoof(obj, 20.4, 55, F.ridge - F.naveWall, M.tileRed, 0, F.naveWall, 1.5, { ridge: 'z', hip: 0.35 });
  for (const s of [-1, 1]) {
    box(obj, 6.4, F.aisleWall, 54, wall, s * 12.7, 0, 1.5);
    box(obj, 6.8, 0.8, 54.4, trim, s * 12.8, F.aisleWall - 0.8, 1.5);
    profileSlab(obj, [[s * 16.2, 0], [s * 9.4, 0], [s * 9.4, 5]], 54.4, M.tileRed, 0, F.aisleWall, 1.5, 0);
    // Pilasters and tall round-headed windows along the flanks, in 6 m bays
    for (let z = -20; z <= 24; z += 6) {
      box(obj, 0.5, F.aisleWall - 1, 1.2, trim, s * 16.1, 0, z - 3);
      box(obj, 0.2, 6, 2, M.glass, s * 16, 7, z);
      box(obj, 0.2, 6, 2.4, M.glass, s * 9.6, F.aisleWall + 3, z);
      box(obj, 0.5, F.naveWall - F.aisleWall - 1, 1.2, trim, s * 9.7, F.aisleWall, z - 3);
    }
  }

  // North front (z ≈ -28): lower storey the full 32 m with six columns on pedestals and the portal; upper storey
  // 19 m wide with four columns, volutes down to the lower cornice, a triangular pediment and statues
  const fz = -27;
  box(obj, 32.4, F.frontLower, 2, wall, 0, 0, fz);
  box(obj, 33, 1.4, 2.8, trim, 0, F.frontLower - 1.4, fz - 0.2);
  box(obj, 19.4, F.frontUpper - F.frontLower, 2, wall, 0, F.frontLower, fz);
  box(obj, 20, 1.2, 2.6, trim, 0, F.frontUpper - 1.2, fz - 0.2);
  for (const x of [-13.5, -8.2, -3.4, 3.4, 8.2, 13.5]) {
    box(obj, 2, 2.4, 2, trim, x, 0, fz - 1.6);
    cylinder(obj, 0.65, 0.75, F.frontLower - 3.8, 12, trim, x, 2.4, fz - 1.6);
  }
  const upperColumn = F.frontUpper - F.frontLower - 1.2;
  for (const x of [-7.6, -3.2, 3.2, 7.6]) cylinder(obj, 0.55, 0.62, upperColumn, 12, trim, x, F.frontLower, fz - 1.4);
  for (const s of [-1, 1]) {
    // Volute: a concave quarter-ellipse wall sweeping from the upper storey's side down to the lower cornice
    const v = [[s * 9.7, 0]];
    for (let i = 0; i <= 6; i++) {
      const a = (i * Math.PI) / 12;
      v.push([s * (15.2 - 5.5 * Math.sin(a)), 9 - 9 * Math.cos(a)]);
    }
    profileSlab(obj, v, 1.6, trim, 0, F.frontLower, fz);
    // Statues on the lower cornice and in the upper niches
    for (const x of [s * 13.5, s * 8.2]) box(obj, 1, 2.6, 1, M.sandstone, x, F.frontLower, fz - 1.4);
    box(obj, 0.6, 3.4, 0.4, M.glass, s * 5.4, F.frontLower + 4.5, fz - 1.05);
  }
  profileSlab(obj, [[-10.4, 0], [10.4, 0], [0, 5.6]], 2.4, trim, 0, F.frontUpper, fz - 0.2);
  profileSlab(obj, [[-9, 0.5], [9, 0.5], [0, 4.8]], 1.6, wall, 0, F.frontUpper, fz - 0.6);
  box(obj, 1, 2.2, 1, M.sandstone, 0, F.frontUpper + 5.6, fz - 0.2);
  // Portal and the big window above it
  box(obj, 4.4, 7.5, 0.4, M.wood, 0, 0, fz - 1.1);
  box(obj, 6, 1, 0.8, trim, 0, 7.5, fz - 1.1);
  box(obj, 3.2, 6, 0.3, M.glass, 0, F.frontLower + 3, fz - 1.05);
  for (const x of [-11, 11]) box(obj, 2, 5, 0.3, M.glass, x, 6, fz - 1.05);
  group.add(obj);

  collider(colliders, -16.2, 16.2, -28.6, 28.5, F.aisleWall);
  collider(colliders, -9.5, 9.5, -28, 28.5, F.naveWall);
  fitToSite([obj], site('Fara'), colliders, c0, { height: F.ridge });
}

// Zamek Królewski on Wzgórze Przemysła, rebuilt 2010–2016 to Witold Milewski's design: a long plastered block with a
// steep tiled roof and buttresses, a lower older wing, and the square tower (11 × 11 m, on the medieval tower's plan)
// at the south-west end with its two viewing terraces (opened 26 June 2016). The outline's +u faces bearing 133°, so
// +z (local) is south-west, where the outline narrows to the tower. No source found for the heights: ≈ 43 m for the
// tower and a 28 m main ridge are estimates from photographs (the tower about 1.5× the main roof ridge).
const ZAMEK = {
  mainWall: 16,
  mainRidge: 28,
  wingWall: 13,
  wingRidge: 21,
  towerShaft: 33,
  towerTop: 43
};

function buildZamek(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const Z = ZAMEK;
  const wall = M.plasterWhite;

  // Main block (17.7 × 19.4 m) under a steep gabled roof running along z, stepped gables at both ends
  box(obj, 17.6, Z.mainWall, 19.4, wall, -0.2, 0, -10.6);
  pitchedRoof(obj, 18.4, 19.8, Z.mainRidge - Z.mainWall, M.tileRed, -0.2, Z.mainWall, -10.6, { ridge: 'z' });
  profileSlab(obj, [[-8.8, 0], [8.8, 0], [0, Z.mainRidge - Z.mainWall]], 0.6, wall, -0.2, Z.mainWall, -20.2);
  // Buttresses along the long walls, where the outline steps out
  for (const [bx, bz] of [[10.1, -12], [10.1, -20.6], [-10.2, -11.4], [-9.9, -20.3], [9.6, -2.7]]) {
    box(obj, 2.6, Z.wingWall - 2, 2, M.plasterCream, bx, 0, bz);
  }
  // Lower wing (the older part) towards the tower, its roof ridge across x
  box(obj, 17.6, Z.wingWall, 12.2, wall, -0.1, 0, 5.2);
  pitchedRoof(obj, 18.4, 12.8, Z.wingRidge - Z.wingWall, M.tileRed, -0.1, Z.wingWall, 5.2, { ridge: 'x' });
  // Windows: rows of small rectangular openings on the long walls of both parts
  for (const s of [-1, 1]) {
    for (let z = -18; z <= 9; z += 3.4) {
      const top = z < -1 ? 3 : 2;
      for (let f = 0; f < top; f++) box(obj, 0.2, 2, 1.2, M.glass, s * 8.85 - 0.1 * s, 3 + f * 4.4, z);
    }
  }
  for (let f = 0; f < 3; f++) {
    for (const x of [-5, 0, 5]) box(obj, 1.2, 2, 0.2, M.glass, x, 3 + f * 4.4, -20.4);
  }

  // Tower (11 × 11 m), plastered shaft with corner quoins, a lower terrace with railings on the shaft and the top
  // terrace under a steep pyramid roof
  const tx = -1.7;
  const tz = 16.1;
  box(obj, 11, Z.towerShaft, 11, wall, tx, 0, tz);
  for (const [qx, qz] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]]) {
    box(obj, 0.8, Z.towerShaft, 0.8, M.sandstone, tx + qx, 0, tz + qz);
  }
  box(obj, 11.8, 0.6, 11.8, M.stoneGrey, tx, Z.towerShaft, tz);
  for (const [dx, dz, w, d] of [[0, 5.8, 11.8, 0.1], [0, -5.8, 11.8, 0.1], [5.8, 0, 0.1, 11.8], [-5.8, 0, 0.1, 11.8]]) {
    box(obj, w, 1.1, d, M.darkMetal, tx + dx, Z.towerShaft + 0.6, tz + dz);
  }
  // Top terrace room: glazed between corner piers, then the roof
  box(obj, 9, 3.4, 9, M.glass, tx, Z.towerShaft + 0.6, tz);
  for (const [qx, qz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
    box(obj, 0.8, 3.4, 0.8, wall, tx + qx, Z.towerShaft + 0.6, tz + qz);
  }
  pitchedRoof(obj, 10.4, 10.4, Z.towerTop - Z.towerShaft - 4, M.tileRed, tx, Z.towerShaft + 4, tz, { hip: 1 });
  for (let f = 0; f < 6; f++) {
    for (const [dx, dz, ry] of [[5.55, 0, 0], [-5.55, 0, 0], [0, 5.55, 1]]) {
      box(obj, ry ? 1.2 : 0.2, 1.8, ry ? 0.2 : 1.2, M.glass, tx + dx, 4 + f * 4.6, tz + dz);
    }
  }
  group.add(obj);

  collider(colliders, -9, 8.8, -20.3, 11.3, Z.wingWall);
  collider(colliders, tx - 5.5, tx + 5.5, tz - 5.5, tz + 5.5, Z.towerShaft);
  fitToSite([obj], site('Zamek Królewski'), colliders, c0, { height: Z.towerTop });
}

// Brama Poznania ICHOT (Ad Artis Architects, 2014): a minimalist architectural-concrete block cut through by a glazed
// diagonal viewing slit that points at the cathedral, its two halves linked by glass walkways on every level
// (pl.wikipedia). No published height: four tall exhibition levels make it ≈ 18 m (OSM's 5 m is wrong). The outline's
// notch at +x, -z marks where the slit opens.
const BRAMA_H = 18;

function buildBrama(group, colliders, M) {
  const c0 = colliders.length;
  const obj = new THREE.Group();
  const H = BRAMA_H;
  // The two halves either side of a slit that runs from (10.4, -3) on the east face to (-10.4, -0.6) on the west face
  prism(obj, [[-10.4, -16.4], [10.4, -16.4], [10.4, -5.2], [-10.4, -2.2]], H, M.concrete, 0, 0, 0);
  prism(obj, [[-10.4, 0.8], [5.6, -1.6], [10.4, -1.9], [10.4, 16.4], [-10.4, 16.4]], H, M.concrete, 0, 0, 0);
  // The glazed slit (recessed curtain of glass) and the walkways crossing it
  prism(obj, [[-9.6, -2.2], [9.6, -5], [9.6, -1.9], [-9.6, 0.8]], H - 0.6, M.glass, 0, 0, 0);
  for (let f = 1; f < 4; f++) prism(obj, [[-2, -2.6], [2, -3.2], [2, -0.9], [-2, -0.3]], 0.5, M.concrete, 0, f * 4.5, 0);
  // Sparse deep-set window bands: a long strip on the west (river) face and a few slots elsewhere
  box(obj, 0.3, 2.4, 10, M.glass, -10.45, 9, 8);
  box(obj, 0.3, 2.4, 6, M.glass, -10.45, 13.5, -9);
  box(obj, 8, 2, 0.3, M.glass, -3, 4, 16.45);
  box(obj, 0.3, 4.2, 3, M.glass, 10.45, 0, 10);
  group.add(obj);

  collider(colliders, -10.4, 10.4, -16.4, 16.4, H);
  fitToSite([obj], site('Brama Poznania'), colliders, c0, { height: H });
}

function buildHeritageLandmarks({ group, colliders, M }) {
  buildKatedra(group, colliders, M);
  buildFara(group, colliders, M);
  buildZamek(group, colliders, M);
  buildBrama(group, colliders, M);
}

export { buildHeritageLandmarks };
