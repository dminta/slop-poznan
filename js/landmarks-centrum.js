import * as THREE from 'three/webgpu';
import { fitToSite, addMesh, box, cylinder, lathe, pitchedRoof, profileSlab, collider, site } from './landmark-kit.js';

// js/landmarks-centrum.js
// The Dzielnica Cesarska (Imperial Quarter) west of the old town: Zamek Cesarski, Teatr Wielki, Collegium Minus, the
// June 1956 crosses on Plac Mickiewicza, and Okrąglak on Mielżyńskiego / Św. Marcin.
//
// Every model is drawn in its site frame (local +x = the site's u axis, +z = its w axis; harness bearings: Zamek +u ≈
// 97°, Teatr 106°, Collegium Minus 75°, Okrąglak 128°, the crosses 90°), so +z faces roughly south on all four
// buildings: Św. Marcin in front of the castle, Park Mickiewicza in front of the theatre.

const DEG = Math.PI / 180;

// Zamek Cesarski (Franz Schwechten, 1905–10). Tower 75 m today (pl.wikipedia technical data; its top storey was taken
// down after the war). The tower stands at the south-west corner, on al. Niepodległości opposite the June 1956 crosses,
// on the square south end of the west wing the OSM outline shows (≈ 16 × 15 m); the main ranges ring the inner
// courtyards north of the forecourt that opens onto Św. Marcin, and the throne-hall wing (entered from Kościuszki) is
// the big south-east block. Ranges: 3 storeys, eaves ≈ 19 m, steep slate roofs (estimated from photos).
const ZAMEK = { top: 75, eaves: 19, roofH: 9 };
// Teatr Wielki (Max Littmann, 1910). No published height: the stage fly tower is estimated at ≈ 27 m from photos (the
// portico's pediment stands at ≈ 21 m, the Pegasus at ≈ 24 m); the auditorium dome and the Pegasus on the portico stay below it. The OSM outline's portico bulge
// (u -23..-1) puts the building's axis at u ≈ -11; the lower east part is the side wing and the former restaurant.
const TEATR = { top: 27, axis: -11 };
// Collegium Minus (Edmund Fürstenau, 1910): eaves 17 m (OSM height), red tile roofs, the round observatory tower on the
// railway (west) side ≈ 27 m (estimate). The outline is turned ≈ 24.5° from the site axes, so the model is drawn in the
// building's own frame (p, q) inside a group turned back by that angle.
const MINUS = { top: 27, eaves: 17, turn: -24.5 * DEG };
// Okrąglak (Marek Leykam, 1948–55): 45 m and 9 storeys (pl.wikipedia), ⌀ 28 m (OSM), a lattice of floor rings and vertical ribs
// over glass, a recessed glazed ground floor and a roof terrace with a balustrade.
const OKRAGLAK = { top: 45, r: 14, ground: 5.5, floors: 8, floorH: 4.4 };
// Pomnik Ofiar Czerwca 1956 (1981): two steel crosses 21 m and 19.5 m (§9.1), bound by a tie with an eagle's head.
const CROSSES = { tall: 21, short: 19.5 };

// Round-arched window: a glass slab with a semicircular head, w wide and h tall (springing included), facing ±z (ry 0)
// or ±x (ry π/2)
function archWindow(parent, w, h, material, x, y, z, ry = 0) {
  const r = w / 2;
  const pts = [[-r, 0], [r, 0], [r, h - r]];
  for (let i = 1; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    pts.push([Math.cos(a) * r, h - r + Math.sin(a) * r]);
  }
  pts.push([-r, h - r]);
  return profileSlab(parent, pts, 0.3, material, x, y, z, ry);
}

// A triangular gable wall (span w, rise h) standing on y, facing ±z (ry 0) or ±x (ry π/2)
function gable(parent, w, h, depth, material, x, y, z, ry = 0) {
  return profileSlab(parent, [[-w / 2, 0], [w / 2, 0], [0, h]], depth, material, x, y, z, ry);
}

function buildCentrumLandmarks({ group, colliders, M }) {
  // --- Zamek Cesarski ------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const wall = M.facade.sandstone;
    const { eaves, roofH } = ZAMEK;
    // Ranges around the courtyards: [u0, u1, w0, w1, ridge]
    const RANGES = [
      [-50, 54, -40, -27, 'x'], // north range
      [-55, -38, -27, 25, 'z'], // west wing on al. Niepodległości (residential)
      [-38, 42, 0, 12.6, 'x'], // main range on the forecourt
      [42, 55, -27, 0, 'z'], // east range
      [-3, 9, -27, 0, 'z'] // cross range between the two courtyards
    ];
    for (const [u0, u1, w0, w1, ridge] of RANGES) {
      box(obj, u1 - u0, eaves, w1 - w0, wall, (u0 + u1) / 2, 0, (w0 + w1) / 2);
      box(obj, u1 - u0 + 0.8, 1.2, w1 - w0 + 0.8, M.stoneGrey, (u0 + u1) / 2, eaves - 1.2, (w0 + w1) / 2); // cornice
      const uc = (u0 + u1) / 2;
      const wc = (w0 + w1) / 2;
      pitchedRoof(obj, u1 - u0 + 0.6, w1 - w0 + 0.6, roofH, M.slate, uc, eaves, wc, { ridge, hip: 0.25 });
      collider(colliders, u0, u1, w0, w1, eaves);
    }
    // Rusticated grey plinth under the ranges
    for (const [u0, u1, w0, w1] of RANGES) {
      box(obj, u1 - u0 + 0.6, 3.2, w1 - w0 + 0.6, M.stoneGrey, (u0 + u1) / 2, 0, (w0 + w1) / 2);
    }
    // Forecourt front: the entrance risalit with a round-arched portal and three Romanesque gables
    box(obj, 10, eaves + 2, 2.2, M.stoneGrey, 5.2, 0, 13.4);
    gable(obj, 10, 7, 2.2, M.stoneGrey, 5.2, eaves + 2, 13.4);
    archWindow(obj, 4.2, 7, M.darkMetal, 5.2, 0, 14.6);
    for (const u of [-24, -10, 24]) {
      gable(obj, 9, 7, 1.2, M.stoneGrey, u, eaves, 12.4);
      archWindow(obj, 2.4, 3.6, M.glass, u, eaves + 0.8, 13.1);
    }
    // The throne-hall wing (south-east): one tall hall lit by big round-arched windows, a steep roof gabled to the
    // street and two round corner turrets
    {
      const u0 = 18;
      const u1 = 55;
      const w0 = 12.6;
      const w1 = 39.5;
      const h = 22;
      const uc = (u0 + u1) / 2;
      const wc = (w0 + w1) / 2;
      box(obj, u1 - u0, h, w1 - w0, M.stoneGrey, uc, 0, wc);
      box(obj, u1 - u0 + 0.8, 1.2, w1 - w0 + 0.8, M.sandstone, uc, h - 1.2, wc);
      pitchedRoof(obj, u1 - u0 - 2, w1 - w0 + 0.6, 13, M.slate, uc, h, wc, { ridge: 'z' });
      gable(obj, u1 - u0 - 2, 13, 1.2, M.stoneGrey, uc, h, w1 - 0.2);
      archWindow(obj, 5, 7, M.glass, uc, h + 1, w1 + 0.3);
      for (const u of [22.5, 29, 35.5, 42, 48.5]) archWindow(obj, 3.6, 10, M.glass, u, 6, w1 + 0.05);
      for (const w of [17, 23, 29, 35]) {
        archWindow(obj, 3.2, 9, M.glass, u1 + 0.05, 6, w, Math.PI / 2);
        archWindow(obj, 3.2, 9, M.glass, u0 - 0.05, 6, w, Math.PI / 2);
      }
      for (const u of [u0 + 1.4, u1 - 2.4]) {
        cylinder(obj, 2.4, 2.4, h + 4, 12, M.stoneGrey, u, 0, w1 - 1.6);
        cylinder(obj, 0, 2.8, 6, 12, M.slate, u, h + 4, w1 - 1.6);
      }
      collider(colliders, u0, u1, w0, w1, h);
    }
    // The tower: a massive square shaft with corner lesenes, a belfry storey of paired round arches, four corner
    // turrets and a steep pyramid roof; the chapel apse on its east face
    {
      const tu = -44;
      const tw = 32.5;
      const s = 15.5;
      box(obj, s + 0.8, 4, s + 0.8, M.stoneGrey, tu, 0, tw); // plinth
      box(obj, s, 54, s, M.stoneGrey, tu, 0, tw);
      for (const du of [-1, 1]) {
        for (const dw of [-1, 1]) {
          box(obj, 2.2, 54, 2.2, M.sandstone, tu + du * (s / 2 - 0.6), 0, tw + dw * (s / 2 - 0.6));
        }
      }
      for (const y of [19, 36, 53]) box(obj, s + 1.2, 1.2, s + 1.2, M.sandstone, tu, y, tw); // string courses
      // Window tiers on the street (+w) and square (-u) faces
      for (const [y, h, w] of [[6, 7, 2.6], [22, 9, 2.2], [39, 9, 2.2]]) {
        for (const d of [-3.2, 0, 3.2]) {
          archWindow(obj, w, h, M.glass, tu + d, y, tw + s / 2 + 0.05);
          archWindow(obj, w, h, M.glass, tu - s / 2 - 0.05, y, tw + d, Math.PI / 2);
        }
      }
      archWindow(obj, 3.4, 5.5, M.darkMetal, tu - s / 2 - 0.1, 0, tw, Math.PI / 2); // the emperor's own door (west)
      // Belfry storey, slightly set in
      const b = s - 1.4;
      box(obj, b, 9, b, M.stoneGrey, tu, 54, tw);
      for (const d of [-3.4, 0, 3.4]) {
        archWindow(obj, 2.2, 6, M.darkMetal, tu + d, 55.5, tw + b / 2 + 0.05);
        archWindow(obj, 2.2, 6, M.darkMetal, tu + d, 55.5, tw - b / 2 - 0.05);
        archWindow(obj, 2.2, 6, M.darkMetal, tu + b / 2 + 0.05, 55.5, tw + d, Math.PI / 2);
        archWindow(obj, 2.2, 6, M.darkMetal, tu - b / 2 - 0.05, 55.5, tw + d, Math.PI / 2);
      }
      box(obj, b + 1.2, 1, b + 1.2, M.sandstone, tu, 63, tw);
      pitchedRoof(obj, b + 0.6, b + 0.6, 11, M.slate, tu, 64, tw, { hip: 1 });
      for (const du of [-1, 1]) {
        for (const dw of [-1, 1]) {
          const x = tu + du * (s / 2 - 0.2);
          const z = tw + dw * (s / 2 - 0.2);
          cylinder(obj, 1.4, 1.4, 10, 10, M.stoneGrey, x, 54, z);
          cylinder(obj, 0, 1.7, 5, 10, M.slate, x, 64, z);
        }
      }
      // Chapel apse (the Byzantine chapel lies in the tower)
      cylinder(obj, 4.2, 4.2, 15, 16, M.stoneGrey, tu + s / 2, 0, tw);
      lathe(obj, [[4.6, 0], [4.2, 1.6], [3, 3.2], [0, 4.4]], 16, M.slate, tu + s / 2, 15, tw);
      collider(colliders, tu - s / 2, tu + s / 2 + 4, tw - s / 2, tw + s / 2, ZAMEK.top);
    }
    group.add(obj);
    fitToSite([obj], site('Zamek Cesarski'), colliders, c0, { height: ZAMEK.top });
  }

  // --- Teatr Wielki ----------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const ax = TEATR.axis;
    const wall = M.facade.plasterCream;
    // Foyer block behind the portico, auditorium with its low dome, stage house with the fly tower
    box(obj, 50, 14, 17, wall, ax + 6, 0, 22.5); // foyer front (u -29..21)
    box(obj, 51, 1, 18, M.sandstone, ax + 6, 13.6, 22.5);
    pitchedRoof(obj, 50, 17, 3, M.zinc, ax + 6, 14.6, 22.5, { ridge: 'x', hip: 0.6 });
    box(obj, 32, 19, 22, M.plasterCream, ax, 0, 3); // auditorium
    box(obj, 33, 1, 23, M.sandstone, ax, 18.6, 3);
    lathe(obj, [[13, 0], [12.6, 1.2], [11, 3], [8, 4.6], [4, 5.6], [0, 6]], 32, M.copper, ax, 19.6, 3);
    box(obj, 32, 22, 27, M.plasterCream, ax + 1, 0, -21.5); // stage house
    box(obj, 26, 4, 21, M.plasterCream, ax + 1, 22, -22); // fly tower top
    pitchedRoof(obj, 27, 22, 1, M.zinc, ax + 1, 26, -22, { ridge: 'x', hip: 0.6 });
    box(obj, 17, 12, 37, wall, ax + 22, 0, -1); // east side wing (u 4..21)
    pitchedRoof(obj, 17.6, 37.6, 4, M.zinc, ax + 22, 12, -1, { ridge: 'z', hip: 0.4 });
    box(obj, 9, 8, 16, M.plasterCream, 25.5, 0, 26); // former restaurant pavilion
    pitchedRoof(obj, 9.6, 16.6, 2.5, M.zinc, 25.5, 8, 26, { ridge: 'z', hip: 0.5 });
    // Portico: six Ionic columns on a stair podium, an entablature and a low pediment crowned by the Pegasus
    const pw = 22;
    const pz = 33.2;
    box(obj, pw + 4, 1.2, 6.4, M.stoneGrey, ax, 0, pz + 0.4);
    box(obj, pw + 1, 2.4, 5, M.sandstone, ax, 0, pz);
    for (let i = 0; i < 6; i++) {
      const u = ax - 9 + i * 3.6;
      cylinder(obj, 0.64, 0.74, 12, 14, M.plasterWhite, u, 2.4, pz + 1.2);
      box(obj, 1.8, 0.6, 1.8, M.plasterWhite, u, 14.4, pz + 1.2); // Ionic capital (volutes read as a slab)
    }
    box(obj, pw + 0.6, 2.4, 6, M.sandstone, ax, 15, pz - 0.3); // entablature
    box(obj, pw + 1.2, 0.6, 6.4, M.plasterWhite, ax, 17.4, pz - 0.3);
    gable(obj, pw + 1.2, 3.6, 6, M.sandstone, ax, 18, pz - 0.3);
    archWindow(obj, 2.2, 4.5, M.glass, ax, 3.5, pz - 2.4);
    for (const d of [-6, 6]) archWindow(obj, 2, 3.8, M.glass, ax + d, 3.5, pz - 2.4);
    // Pegasus rearing on the pediment, wings raised
    {
      const peg = new THREE.Group();
      box(peg, 3, 1.2, 1.1, M.bronze, 0, 1.5, 0).rotation.z = 0.35;
      box(peg, 0.5, 1.8, 0.5, M.bronze, 1.5, 2.3, 0).rotation.z = -0.4; // neck
      box(peg, 1, 0.5, 0.45, M.bronze, 2.1, 3.7, 0).rotation.z = -0.3; // head
      for (const s of [-0.3, 0.3]) {
        box(peg, 0.3, 1.6, 0.3, M.bronze, -1.1, 0, s); // hind legs
        box(peg, 0.3, 1.2, 0.3, M.bronze, 1.4, 1.7, s).rotation.z = 0.9; // fore legs, raised
        const wing = profileSlab(peg, [[0, 0], [1.6, 0.3], [0.2, 3.2], [-1.4, 2.4]], 0.15, M.bronze, 0, 2, s * 2);
        wing.rotation.x = s * 1.2;
      }
      peg.rotation.y = Math.PI / 2;
      peg.position.set(ax, 20.6, pz);
      obj.add(peg);
    }
    collider(colliders, ax - 19, ax + 31, 14, 31, 14);
    collider(colliders, ax - 16, ax + 16, -35, 14, 22);
    collider(colliders, ax + 13.5, ax + 30.5, -19.5, 17.5, 12);
    collider(colliders, 21, 30, 18, 34, 8);
    collider(colliders, ax - pw / 2 - 2, ax + pw / 2 + 2, pz - 2.8, pz + 3.6, 2.4); // stairs; the colonnade stays open
    group.add(obj);
    fitToSite([obj], site('Teatr Wielki'), colliders, c0, { height: TEATR.top });
  }

  // --- Collegium Minus -------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const inner = new THREE.Group(); // the building's own frame (p, q), turned back onto the site axes
    inner.rotation.y = MINUS.turn;
    obj.add(inner);
    const wall = M.facade.plasterCream;
    const { eaves } = MINUS;
    // [p0, p1, q0, q1, ridge, eaves] traced from the OSM outline in the building frame
    const WINGS = [
      [-15.9, 5.4, -52.9, -37, 'x', eaves], // north wing
      [-6.8, 5.2, -37, -17, 'z', eaves], // spine
      [-29.7, 11, -17, 0, 'x', eaves], // cross wing
      [-1.8, 10.5, 0, 13.4, 'z', eaves - 2], // neck
      [10.3, 27.6, 8.4, 13, 'x', eaves - 2],
      [-9.5, 35.8, 13.4, 46.5, 'x', eaves + 2] // Aula block facing Plac Mickiewicza
    ];
    for (const [p0, p1, q0, q1, ridge, h] of WINGS) {
      const pc = (p0 + p1) / 2;
      const qc = (q0 + q1) / 2;
      box(inner, p1 - p0, h, q1 - q0, wall, pc, 0, qc);
      box(inner, p1 - p0 + 0.6, 0.8, q1 - q0 + 0.6, M.sandstone, pc, h - 0.8, qc);
      box(inner, p1 - p0 + 0.4, 1.6, q1 - q0 + 0.4, M.sandstone, pc, 0, qc);
      const span = ridge === 'x' ? q1 - q0 : p1 - p0;
      const rise = Math.min(8, span * 0.42);
      pitchedRoof(inner, p1 - p0 + 0.6, q1 - q0 + 0.6, rise, M.tileRed, pc, h, qc, { ridge, hip: 0.35 });
    }
    // The two porticoes with tall gables on the Aula front (+p, towards the square)
    for (const q of [20.5, 39.5]) {
      box(inner, 2.4, eaves + 2, 11, M.plasterCream, 36.6, 0, q);
      gable(inner, 11, 9, 2.4, M.plasterCream, 36.6, eaves + 2, q, Math.PI / 2);
      box(inner, 3.6, 7, 11.6, M.sandstone, 37.2, 0, q); // columned porch, read as a block
      archWindow(inner, 3.4, 6.5, M.glass, 37.85, 7.5, q, Math.PI / 2);
      archWindow(inner, 2.2, 3.4, M.glass, 37.85, eaves + 3, q, Math.PI / 2);
    }
    // Aula: tall round-headed windows between them
    for (const q of [26.5, 30, 33.5]) archWindow(inner, 2.2, 8, M.glass, 35.85, 6, q, Math.PI / 2);
    // Gables on the north and cross wings' ends
    gable(inner, 21.3, 7, 1, M.plasterCream, -5.25, eaves, -53.2);
    gable(inner, 17, 7, 1, M.plasterCream, -29.9, eaves, -8.5, Math.PI / 2);
    // Round observatory tower in the corner on the railway side, under a small copper dome
    cylinder(inner, 4, 4, 22, 20, M.plasterCream, -11.4, 0, -34.8);
    cylinder(inner, 4.4, 4.4, 1, 20, M.sandstone, -11.4, 21, -34.8);
    lathe(inner, [[4, 0], [3.8, 1.6], [3, 3.2], [1.6, 4.3], [0, 5]], 20, M.copper, -11.4, 22, -34.8);
    for (const a of [0, 1, 2, 3]) {
      const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
      const x = -11.4 + Math.cos(ang) * 4.02;
      const z = -34.8 + Math.sin(ang) * 4.02;
      archWindow(inner, 1.4, 2.6, M.glass, x, 17, z, Math.PI / 2 - ang);
    }
    // Colliders in the site frame: each wing's turned rect, covered by its axis-aligned box (outline-sized, slightly
    // generous at the corners)
    const cs = Math.cos(MINUS.turn);
    const sn = Math.sin(MINUS.turn);
    for (const [p0, p1, q0, q1, , h] of WINGS) {
      let u0 = Infinity;
      let u1 = -Infinity;
      let w0 = Infinity;
      let w1 = -Infinity;
      for (const [p, q] of [[p0, q0], [p1, q0], [p1, q1], [p0, q1]]) {
        const u = p * cs + q * sn;
        const w = -p * sn + q * cs;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        w0 = Math.min(w0, w);
        w1 = Math.max(w1, w);
      }
      // An axis-aligned box over a 24.5°-turned wing would swallow its neighbours' gaps: shrink it towards the centre
      const su = (u1 - u0) * 0.15;
      const sw = (w1 - w0) * 0.08;
      collider(colliders, u0 + su, u1 - su, w0 + sw, w1 - sw, h);
    }
    group.add(obj);
    fitToSite([obj], site('Collegium Minus'), colliders, c0, { height: MINUS.top });
  }

  // --- Okrąglak --------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const { r, ground, floors, floorH } = OKRAGLAK;
    const roofY = ground + floors * floorH; // 40.7 m
    // Recessed glazed ground floor on slim round columns
    cylinder(obj, r - 2, r - 2, ground, 32, M.glass, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      cylinder(obj, 0.35, 0.35, ground, 8, M.concrete, Math.cos(a) * (r - 0.8), 0, Math.sin(a) * (r - 0.8));
    }
    // Upper storeys: a glass drum behind the lattice of floor rings and vertical ribs
    cylinder(obj, r - 0.9, r - 0.9, roofY - ground, 40, M.glass, 0, ground, 0);
    for (let f = 0; f <= floors; f++) {
      cylinder(obj, r, r, f === floors ? 1.6 : 0.5, 48, M.concrete, 0, ground + f * floorH - 0.25, 0);
    }
    const RIBS = 48;
    for (let i = 0; i < RIBS; i++) {
      const a = (i / RIBS) * Math.PI * 2;
      box(obj, 0.25, roofY - ground, 1.1, M.concrete, Math.cos(a) * (r - 0.55), ground, Math.sin(a) * (r - 0.55), -a);
    }
    // Roof terrace: a railing ring, the stair drum and a machine room
    const rail = new THREE.CylinderGeometry(r - 0.3, r - 0.3, 1.1, 48, 1, true);
    addMesh(obj, rail, M.steel, 0, roofY + 1.35 + 0.55, 0);
    cylinder(obj, 2.8, 2.8, OKRAGLAK.top - roofY - 0.6, 20, M.concrete, 0, roofY + 1.35, 0);
    box(obj, 7, 2.6, 4, M.concrete, 3.5, roofY + 1.35, 0);
    box(obj, 6.4, 0.25, 6.4, M.concrete, 0, OKRAGLAK.top - 0.25, 0);
    collider(colliders, -r + 1.5, r - 1.5, -r + 1.5, r - 1.5, roofY);
    group.add(obj);
    fitToSite([obj], site('Okrąglak'), colliders, c0, { height: OKRAGLAK.top });
  }

  // --- Pomnik Ofiar Czerwca 1956 ---------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    box(obj, 9, 0.5, 6, M.granite, 0, 0, 0); // low plinth
    box(obj, 7.5, 0.4, 4.5, M.stoneGrey, 0, 0.5, 0);
    // Two crosses side by side, the taller on the left (seen from the square), arms 6 m wide
    const CROSS = [[-1.6, CROSSES.tall], [1.6, CROSSES.short]];
    for (const [x, h] of CROSS) {
      box(obj, 0.9, h - 0.9, 0.9, M.steel, x, 0.9, 0);
      box(obj, 6, 0.9, 0.9, M.steel, x, h - 6.5, 0);
      box(obj, 1.3, 1.2, 1.3, M.darkMetal, x, 0.9, 0); // foot
    }
    // The tie binding the shafts below the arms: a twisted band, with the eagle's head over it
    for (let i = 0; i < 5; i++) {
      const y = CROSSES.short - 9.5 - i * 0.55;
      const b = box(obj, 4.6, 0.32, 1.4, M.darkMetal, 0, y, 0);
      b.rotation.z = (i % 2 ? 1 : -1) * 0.12;
    }
    box(obj, 1.1, 1.8, 1.2, M.steel, 0, CROSSES.short - 8.7, 0.25); // eagle's head
    box(obj, 0.8, 0.5, 0.9, M.steel, 0, CROSSES.short - 7.7, 0.75).rotation.x = 0.5; // beak
    // The years of the protests, on plates along the taller shaft's foot
    for (let i = 0; i < 5; i++) box(obj, 0.7, 0.35, 0.08, M.darkMetal, -1.6, 2.2 + i * 0.6, 0.5);
    collider(colliders, -4.5, 4.5, -3, 3, 0.9);
    collider(colliders, -2.1, 2.1, -0.5, 0.5, CROSSES.tall);
    group.add(obj);
    fitToSite([obj], site('Pomnik Czerwca 1956'), colliders, c0, { height: CROSSES.tall });
  }
}

export { buildCentrumLandmarks };
