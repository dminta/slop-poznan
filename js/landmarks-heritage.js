import * as THREE from 'three/webgpu';
import { fitToSite, addMesh, box, cylinder, lathe, pitchedRoof, prism, profileSlab, collider, site } from './landmark-kit.js';
import { SRODKA_MURAL, CITY_BOUNDS } from './city-config.js';

// js/landmarks-heritage.js
// The historic landmarks of Ostrów Tumski, the Old Town hill and Śródka: the Katedra, the Fara, the Zamek Królewski on
// Wzgórze Przemysła, the Brama Poznania ICHOT on the Cybina and Śródka's mural square. Modelled in metres around a local origin (conventions
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
// (outline +u faces bearing 98°, so -z is north). The nave ridge measures 36.6-37.1 m above ground in the GUGiK lidar
// (NMPT−NMT, ISOK 2011; docs/observations/landmark-heights-2026-11-03.md); the 40 m cells are only a ~6 × 2 m strip
// on the rear gable, and the north front reads 38.5-39.3 m. The model keeps a 37 m ridge under the 40 m overall top
// (the pediment statue) and the front's cornice and statues stay estimates. No dome is modelled: none shows outside.
const FARA = {
  naveWall: 29,
  ridge: 37,
  top: 40,
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
  fitToSite([obj], site('Fara'), colliders, c0, { height: F.top });
}

// Zamek Królewski on Wzgórze Przemysła, rebuilt 2010–2016 to Witold Milewski's design: a long plastered block with a
// steep tiled roof and buttresses, a lower older wing, and the square tower (11 × 11 m, on the medieval tower's plan)
// at the south-west end with its two viewing terraces (opened 26 June 2016). The outline's +u faces bearing 133°, so
// +z (local) is south-west, where the outline narrows to the tower. Sourced measurements (Muzeum Narodowe w Poznaniu /
// poznan.pl): tower apex 43.0 m, covered lower viewing terrace 30.0 m. Main ridge 28 m and wing 21 m remain estimates.
const ZAMEK = {
  mainWall: 16,
  mainRidge: 28,
  wingWall: 13,
  wingRidge: 21,
  towerShaft: 30,
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
// diagonal viewing slit pointing at the cathedral, its two halves linked by glass walkways on every level. The largest
// external monolithic wall is 32.9 × 16.3 m (AD Artis Architects technical record in Architektura Murator; Murator
// also notes height ≈ half the base side). The outline's notch at +x, -z marks where the slit opens.
const BRAMA_H = 16.3;

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

// -------------------------------------------------------------------------------------------------------------------
// Śródka's mural square: "Opowieść Śródecka" (2015), the trompe-l'œil on the east gable wall of ul. Śródka 3 over the
// little square at Śródka / Rynek Śródecki (city-config.js SRODKA_MURAL; the wall and the house's depth come from the
// OSM footprint). The mural paints the old Śródka it stands in: a row of narrow kamienice with their gables against
// the sky, windows with shutters, flower boxes and neighbours leaning out, a gateway opening on a street that runs
// off towards a church tower, shops on the ground floor, a black cat on a sill and pigeons on a cornice. It is a
// procedural canvas (no image asset), painted once at build time; without a DOM (tests) the wall is plain render.
// The house is four storeys under a hipped tile roof; the square gets setts, benches facing the mural, two hedged
// planters and a lamp. Heights and the mural's composition are estimates from photographs.
// -------------------------------------------------------------------------------------------------------------------
const MURAL_H = 14.4; // eave of the house: four 3.6 m storeys
const MURAL_PX = 2048; // canvas width; the height follows the wall's proportions

// Deterministic generator for the painting (mulberry32), so every build paints the same mural
function muralRand(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A neighbour at a window: head, hair and shoulders filling the lower part of the opening (x, y: its centre bottom)
function paintFigure(g, x, y, s, rand, leaning) {
  const skin = ['#e8bfa0', '#d9a888', '#c99272'][Math.floor(rand() * 3)];
  const cloth = ['#7a2f2f', '#2f4f7a', '#3d6b3a', '#c98f2e', '#6b4a7a'][Math.floor(rand() * 5)];
  const hair = ['#3a2a1e', '#6b4a2a', '#b8b0a4', '#1e1a18', '#a8642e'][Math.floor(rand() * 5)];
  g.fillStyle = cloth;
  g.beginPath();
  g.moveTo(x - s * 0.42, y);
  g.quadraticCurveTo(x - s * 0.4, y - s * 0.55, x, y - s * 0.58);
  g.quadraticCurveTo(x + s * 0.4, y - s * 0.55, x + s * 0.42, y);
  g.fill();
  if (leaning) {
    // forearms on the sill
    g.fillStyle = skin;
    g.fillRect(x - s * 0.5, y - s * 0.1, s * 0.3, s * 0.09);
    g.fillRect(x + s * 0.2, y - s * 0.1, s * 0.3, s * 0.09);
  }
  g.fillStyle = skin;
  g.beginPath();
  g.arc(x, y - s * 0.78, s * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.arc(x, y - s * 0.84, s * 0.21, Math.PI, Math.PI * 2);
  g.fill();
}

// A black cat sitting side-on, facing left, its tail curled round its feet (x, y: between its front paws)
function paintCat(g, x, y, s) {
  g.fillStyle = '#16141a';
  g.beginPath();
  g.ellipse(x + s * 0.25, y - s * 0.32, s * 0.3, s * 0.34, 0, 0, Math.PI * 2); // body
  g.fill();
  g.beginPath();
  g.arc(x, y - s * 0.72, s * 0.17, 0, Math.PI * 2); // head
  g.fill();
  g.beginPath(); // ears
  g.moveTo(x - s * 0.15, y - s * 0.8);
  g.lineTo(x - s * 0.12, y - s * 0.98);
  g.lineTo(x - s * 0.02, y - s * 0.86);
  g.moveTo(x + s * 0.02, y - s * 0.87);
  g.lineTo(x + s * 0.12, y - s * 0.98);
  g.lineTo(x + s * 0.15, y - s * 0.8);
  g.fill();
  g.strokeStyle = '#16141a';
  g.lineWidth = s * 0.08;
  g.lineCap = 'round';
  g.beginPath(); // tail
  g.moveTo(x + s * 0.5, y - s * 0.1);
  g.quadraticCurveTo(x + s * 0.75, y + s * 0.02, x + s * 0.55, y - s * 0.02);
  g.quadraticCurveTo(x + s * 0.1, y + s * 0.02, x - s * 0.05, y - s * 0.02);
  g.stroke();
  g.fillStyle = '#e8c33a'; // eyes
  g.beginPath();
  g.arc(x - s * 0.08, y - s * 0.74, s * 0.035, 0, Math.PI * 2);
  g.arc(x + s * 0.06, y - s * 0.74, s * 0.035, 0, Math.PI * 2);
  g.fill();
}

// A pigeon side-on (x, y: its feet), facing left or right
function paintPigeon(g, x, y, s, dir) {
  g.fillStyle = '#8a8f98';
  g.beginPath();
  g.ellipse(x, y - s * 0.4, s * 0.45, s * 0.28, dir * 0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6a707a';
  g.beginPath();
  g.arc(x - dir * s * 0.38, y - s * 0.68, s * 0.16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4a7a6e';
  g.fillRect(x - dir * s * 0.32 - s * 0.1, y - s * 0.56, s * 0.2, s * 0.08);
}

// One window: a recessed opening with a white casement, shutters on some, a flower box on others, now and then a
// neighbour or the cat. w, h: the opening; returns nothing
function paintWindow(g, x, y, w, h, rand, extras) {
  g.fillStyle = 'rgba(0, 0, 0, 0.18)'; // the reveal's shadow
  g.fillRect(x - w * 0.08, y - h * 0.06, w * 1.16, h * 1.12);
  g.fillStyle = '#efe7d6'; // stucco surround
  g.fillRect(x - w * 0.12, y + h, w * 1.24, h * 0.07);
  g.fillRect(x - w * 0.1, y - h * 0.12, w * 1.2, h * 0.08);
  const sky = g.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, '#5f7d96');
  sky.addColorStop(1, '#22303e');
  g.fillStyle = sky;
  g.fillRect(x, y, w, h);
  const r = rand();
  if (r < extras.figure) paintFigure(g, x + w * 0.5, y + h, w * 0.85, rand, rand() < 0.5);
  else if (r < extras.figure + 0.12) {
    g.fillStyle = '#efe4cf'; // drawn curtains
    g.fillRect(x, y, w * 0.28, h);
    g.fillRect(x + w * 0.72, y, w * 0.28, h);
  }
  g.strokeStyle = '#f4efe4';
  g.lineWidth = Math.max(2, w * 0.07);
  g.strokeRect(x, y, w, h);
  g.beginPath();
  g.moveTo(x + w * 0.5, y);
  g.lineTo(x + w * 0.5, y + h);
  g.moveTo(x, y + h * 0.3);
  g.lineTo(x + w, y + h * 0.3);
  g.stroke();
  if (rand() < extras.shutters) {
    g.fillStyle = extras.shutterColor;
    for (const sx of [x - w * 0.55, x + w * 1.05]) {
      g.fillRect(sx, y, w * 0.5, h);
      g.fillStyle = 'rgba(0, 0, 0, 0.25)';
      for (let k = 1; k < 8; k++) g.fillRect(sx, y + (h * k) / 8, w * 0.5, Math.max(1, h * 0.015));
      g.fillStyle = extras.shutterColor;
    }
  }
  if (rand() < extras.flowers) {
    g.fillStyle = '#6b3d22';
    g.fillRect(x - w * 0.05, y + h - h * 0.12, w * 1.1, h * 0.14);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k % 2 ? '#3f7a34' : ['#d23a3a', '#e8c040', '#d860a0'][Math.floor(rand() * 3)];
      g.beginPath();
      g.arc(x + w * (0.05 + k * 0.15), y + h - h * 0.14, w * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// The painting, MURAL_PX wide on a wall `wallW` × `wallH` metres. Composition (left to right): two kamienice, a gateway
// opening on a street running off to a church tower, two more kamienice; each house its own render colour, cornices,
// a gable against a painted sky, three upper storeys of windows and a shop front on the ground floor
function paintMural(wallW, wallH) {
  const W = MURAL_PX;
  const H = Math.round((W * wallH) / wallW);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const rand = muralRand(2015);
  const px = W / wallW; // pixels per metre
  const yOf = (m) => H - m * px; // metres above the ground → canvas y

  // Sky over the painted roofline, paler at the horizon, a few clouds
  const sky = g.createLinearGradient(0, 0, 0, H * 0.4);
  sky.addColorStop(0, '#7fa7cc');
  sky.addColorStop(1, '#cfe0ea');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let k = 0; k < 5; k++) {
    const cx = rand() * W;
    const cy = H * (0.04 + rand() * 0.12);
    for (let j = 0; j < 4; j++) {
      g.beginPath();
      g.ellipse(cx + (j - 1.5) * 34, cy + (j % 2) * 8, 46, 20, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // The gateway's street: a lane between the houses running off to a vanishing point, its far end a church tower
  const gate0 = wallW * 0.43;
  const gate1 = wallW * 0.57;
  const vx = (gate0 + gate1) * 0.5 * px;
  const vy = yOf(3.6);
  g.fillStyle = '#b9b2a4';
  g.beginPath(); // setts
  g.moveTo(gate0 * px, H);
  g.lineTo(gate1 * px, H);
  g.lineTo(vx + 10, vy);
  g.lineTo(vx - 10, vy);
  g.fill();
  g.strokeStyle = 'rgba(80, 70, 60, 0.35)';
  g.lineWidth = 2;
  for (let k = 1; k < 9; k++) {
    const t = (k / 9) ** 1.6;
    const y = H + (vy - H) * t;
    const hw = ((gate1 - gate0) * px * 0.5) * (1 - t) + 10 * t;
    g.beginPath();
    g.moveTo(vx - hw, y);
    g.lineTo(vx + hw, y);
    g.stroke();
  }
  for (const side of [-1, 1]) {
    // receding house fronts either side of the lane
    const xNear = side < 0 ? gate0 * px : gate1 * px;
    g.fillStyle = side < 0 ? '#d8b98a' : '#c9a0a0';
    g.beginPath();
    g.moveTo(xNear, H);
    g.lineTo(xNear, yOf(9.5));
    g.lineTo(vx + side * 18, vy - 120);
    g.lineTo(vx + side * 18, vy);
    g.fill();
    g.fillStyle = 'rgba(40, 50, 60, 0.55)';
    for (let k = 0; k < 5; k++) {
      const t = 0.12 + k * 0.17;
      const x = xNear + (vx + side * 18 - xNear) * t;
      for (const m of [4.5, 7.2]) {
        const yNear = yOf(m);
        const y = yNear + (vy - 45 - yNear) * t;
        g.fillRect(x - 6 * (1 - t) - 2, y, (12 * (1 - t) + 3) * (side < 0 ? 1 : -1), 28 * (1 - t) + 6);
      }
    }
  }
  // the church tower at the lane's end (St Margaret's, which stands on Rynek Śródecki)
  g.fillStyle = '#a5473a';
  g.fillRect(vx - 22, vy - 230, 44, 230);
  g.fillStyle = '#4f7f6c';
  g.beginPath();
  g.moveTo(vx - 26, vy - 230);
  g.lineTo(vx, vy - 330);
  g.lineTo(vx + 26, vy - 230);
  g.fill();

  // The four kamienice, two either side of the gateway
  const houses = [
    { x0: 0, x1: wallW * 0.22, color: '#d9a86a', top: 12.9, gable: 'stepped', shutter: '#3f6b4a' },
    { x0: wallW * 0.22, x1: gate0, color: '#d79a92', top: 13.8, gable: 'volute', shutter: '#4a5f7a' },
    { x0: gate1, x1: wallW * 0.79, color: '#a9c2a0', top: 13.4, gable: 'triangle', shutter: '#7a3b2e' },
    { x0: wallW * 0.79, x1: wallW, color: '#e3cf7e', top: 12.6, gable: 'stepped', shutter: '#3f5e3a' }
  ];
  for (const hs of houses) {
    const x0 = hs.x0 * px;
    const x1 = hs.x1 * px;
    const w = x1 - x0;
    const eave = yOf(hs.top - 2.6);
    const top = yOf(hs.top);
    g.fillStyle = hs.color;
    g.fillRect(x0, eave, w, H - eave);
    // the painted gable over the eave
    g.beginPath();
    if (hs.gable === 'triangle') {
      g.moveTo(x0, eave);
      g.lineTo(x0 + w * 0.5, top);
      g.lineTo(x1, eave);
    } else if (hs.gable === 'stepped') {
      const steps = 3;
      g.moveTo(x0, eave);
      for (let k = 0; k < steps; k++) {
        const yk = eave + ((top - eave) * (k + 1)) / (steps + 1);
        g.lineTo(x0 + (w * 0.5 * k) / (steps + 0.5), yk);
        g.lineTo(x0 + (w * 0.5 * (k + 1)) / (steps + 0.5), yk);
      }
      g.lineTo(x0 + w * 0.43, top);
      g.lineTo(x1 - w * 0.43, top);
      for (let k = steps - 1; k >= 0; k--) {
        const yk = eave + ((top - eave) * (k + 1)) / (steps + 1);
        g.lineTo(x1 - (w * 0.5 * (k + 1)) / (steps + 0.5), yk);
        g.lineTo(x1 - (w * 0.5 * k) / (steps + 0.5), yk);
      }
      g.lineTo(x1, eave);
    } else {
      g.moveTo(x0, eave);
      g.bezierCurveTo(x0 + w * 0.15, eave, x0 + w * 0.2, eave - (eave - top) * 0.7, x0 + w * 0.32, eave - (eave - top) * 0.75);
      g.lineTo(x0 + w * 0.36, top + (eave - top) * 0.15);
      g.lineTo(x0 + w * 0.5, top);
      g.lineTo(x1 - w * 0.36, top + (eave - top) * 0.15);
      g.lineTo(x1 - w * 0.32, eave - (eave - top) * 0.75);
      g.bezierCurveTo(x1 - w * 0.2, eave - (eave - top) * 0.7, x1 - w * 0.15, eave, x1, eave);
    }
    g.closePath();
    g.fill();
    // attic window in the gable
    g.fillStyle = '#22303e';
    g.fillRect(x0 + w * 0.45, eave - (eave - top) * 0.55, w * 0.1, (eave - top) * 0.3);
    // shading down one side (the houses read as separate fronts) and a little weathering
    const shade = g.createLinearGradient(x0, 0, x1, 0);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
    shade.addColorStop(0.15, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(0.9, 'rgba(255, 255, 255, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    g.fillStyle = shade;
    g.fillRect(x0, eave, w, H - eave);
    // cornice and string courses
    g.fillStyle = '#f2ebdd';
    g.fillRect(x0 - 4, eave - 6, w + 8, 18);
    for (const m of [3.9, 7.4, 10.9]) g.fillRect(x0, yOf(m), w, 9);
    // upper storeys: two or three window axes
    const axes = w > 3.6 * px ? 3 : 2;
    const ww = Math.min(0.95 * px, (w / axes) * 0.42);
    for (const m of [4.6, 8.1, 11.6]) {
      if (m + 1.6 > hs.top - 2.6) continue;
      for (let k = 0; k < axes; k++) {
        const cx = x0 + (w * (k + 0.5)) / axes;
        paintWindow(g, cx - ww * 0.5, yOf(m + 1.6), ww, 1.6 * px, rand, { figure: 0.22, shutters: 0.45, flowers: 0.35, shutterColor: hs.shutter });
      }
    }
    // ground floor: a shop window and a door under a striped awning
    g.fillStyle = '#2a3440';
    g.fillRect(x0 + w * 0.12, yOf(2.9), w * 0.42, 2.3 * px);
    g.fillStyle = '#5a3a26';
    g.fillRect(x0 + w * 0.66, yOf(2.8), w * 0.2, 2.8 * px);
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k % 2 ? '#f2ebdd' : hs.shutter;
      g.fillRect(x0 + w * 0.08 + (w * 0.5 * k) / 6, yOf(3.5), (w * 0.5) / 6 + 1, 0.5 * px);
    }
  }
  // the gateway's arch over the lane, in the masonry between the middle houses
  g.fillStyle = '#e5d6b8';
  g.fillRect(gate0 * px, yOf(13.1), (gate1 - gate0) * px, yOf(7.0) - yOf(13.1));
  g.fillStyle = '#d0bf9e';
  g.beginPath();
  g.moveTo(gate0 * px, yOf(7.0));
  g.lineTo(gate1 * px, yOf(7.0));
  g.lineTo(gate1 * px, yOf(7.5));
  g.lineTo(gate0 * px, yOf(7.5));
  g.fill();
  paintWindow(g, (gate0 + 0.35) * px, yOf(9.6), (gate1 - gate0 - 0.7) * px, 1.8 * px, rand, { figure: 1, shutters: 0, flowers: 1, shutterColor: '#000' });
  paintWindow(g, (gate0 + 0.35) * px, yOf(12.7), (gate1 - gate0 - 0.7) * px, 1.8 * px, rand, { figure: 0, shutters: 0, flowers: 0, shutterColor: '#000' });

  // the cat on the sill of the right-hand house's first floor, pigeons along the left house's cornice
  paintCat(g, (wallW * 0.68) * px, yOf(4.62), 0.9 * px);
  for (let k = 0; k < 4; k++) paintPigeon(g, (0.8 + k * 0.9 + rand() * 0.3) * px, yOf(10.95), 0.42 * px, k % 2 ? 1 : -1);

  // weathering over everything: faint blotches and a darker plinth where the rain splashes
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '255, 255, 255' : '0, 0, 0'}, ${0.02 + rand() * 0.04})`;
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 18, 2 + rand() * 18);
  }
  const plinth = g.createLinearGradient(0, yOf(0.8), 0, H);
  plinth.addColorStop(0, 'rgba(40, 34, 28, 0)');
  plinth.addColorStop(1, 'rgba(40, 34, 28, 0.35)');
  g.fillStyle = plinth;
  g.fillRect(0, yOf(0.8), W, 0.8 * px);
  return canvas;
}

let _muralMaterial = null;
function muralMaterial(wallW, wallH, M) {
  if (_muralMaterial) return _muralMaterial;
  if (typeof document === 'undefined') return M.plasterCream;
  const tex = new THREE.CanvasTexture(paintMural(wallW, wallH));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  _muralMaterial = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.9, metalness: 0 });
  return _muralMaterial;
}

// A bench (seat, back, two cast-iron frames), facing local +z, centred on (x, z), standing on y
function bench(parent, x, y, z, M) {
  box(parent, 1.8, 0.06, 0.42, M.wood, x, y + 0.42, z);
  box(parent, 1.8, 0.36, 0.05, M.wood, x, y + 0.52, z - 0.22);
  for (const s of [-0.8, 0.8]) box(parent, 0.06, 0.88, 0.5, M.darkMetal, x + s, y, z - 0.02);
}

function buildSrodkaMural(group, colliders, M) {
  const S = SRODKA_MURAL;
  const obj = new THREE.Group();
  const L = S.len;
  const D = S.depth;
  const deck = CITY_BOUNDS.sidewalkHeight;

  // The house: four storeys of render behind the wall (local z from -D to 0), a hipped tile roof
  box(obj, L, MURAL_H, D, M.facade.plasterCream, 0, 0, -D / 2);
  box(obj, L + 0.5, 0.5, D + 0.5, M.plasterWhite, 0, MURAL_H - 0.5, -D / 2); // eaves cornice
  pitchedRoof(obj, L + 0.6, D + 0.6, 4.2, M.tileRed, 0, MURAL_H, -D / 2, { ridge: 'x', hip: 0.7 });
  // The mural over the whole wall, 3 cm proud of it
  const wallH = MURAL_H - 0.5 - deck;
  addMesh(obj, new THREE.PlaneGeometry(L, wallH), muralMaterial(L, wallH, M), 0, deck + wallH / 2, 0.03);
  // The square: granite setts on the deck out to the curb, benches facing the mural, planters and a lamp
  box(obj, L - 1.5, 0.03, S.square - 1, M.stoneGrey, -0.5, deck, S.square / 2 - 0.2);
  const benches = [-5.5, 0, 5.5];
  for (const x of benches) bench(obj, x, deck, 8.5, M);
  for (const x of [-8.6, 7.6]) {
    box(obj, 2.2, 0.7, 1.1, M.granite, x, deck, 11.5);
    box(obj, 2, 0.55, 0.9, M.hedge, x, deck + 0.7, 11.5);
  }
  cylinder(obj, 0.07, 0.1, 4.2, 8, M.darkMetal, -1.8, deck, 13);
  cylinder(obj, 0.22, 0.22, 0.45, 10, M.warmLit, -1.8, deck + 4.2, 13);
  obj.position.set(S.cx, 0, S.cz);
  obj.rotation.y = S.ang;
  group.add(obj);

  // Colliders in the house frame → oriented boxes (the shape buildings.js pushCollider and fitToSite emit)
  const push = (x0, x1, z0, z1, maxY) => {
    const c = S.toWorld((x0 + x1) * 0.5, (z0 + z1) * 0.5);
    const hx = (x1 - x0) * 0.5;
    const hz = (z1 - z0) * 0.5;
    const ex = Math.abs(S.cs) * hx + Math.abs(S.sn) * hz;
    const ez = Math.abs(S.sn) * hx + Math.abs(S.cs) * hz;
    colliders.push({ minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez, maxY, obb: { cx: c.x, cz: c.z, hx, hz, cs: S.cs, sn: S.sn } });
  };
  push(-L / 2, L / 2, -D, 0.05, MURAL_H + 4.2);
  for (const x of benches) push(x - 0.95, x + 0.95, 8.2, 8.8, deck + 0.92);
  for (const x of [-8.6, 7.6]) push(x - 1.1, x + 1.1, 10.95, 12.05, deck + 1.25);
  push(-2, -1.6, 12.8, 13.2, deck + 4.65);
}

function buildHeritageLandmarks({ group, colliders, M }) {
  buildKatedra(group, colliders, M);
  buildFara(group, colliders, M);
  buildZamek(group, colliders, M);
  buildBrama(group, colliders, M);
  buildSrodkaMural(group, colliders, M);
}

export { buildHeritageLandmarks };
