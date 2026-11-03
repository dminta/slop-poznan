import * as THREE from 'three/webgpu';
import { fitToSite, box, cylinder, pitchedRoof, profileSlab, addMesh, collider, site } from './landmark-kit.js';

// js/landmarks-dworzec.js
// The landmarks around Poznań Główny and the fairground (Łazarz / Centrum): the 2012 station hall over the tracks, the
// 1879 station building, the Avenida mall, the Stary Browar brewery-turned-mall and the Iglica spire of the
// Międzynarodowe Targi Poznańskie. Every site here is turned (ang ≈ -11° … -31°), so local +x points ESE / SE.

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// A thin round member from a to b (lattice legs, diagonals, struts): 4-sided and open-ended, so a 60 m lattice of
// ~250 members stays under 3k triangles
function strut(parent, a, b, r, material) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  const m = addMesh(parent, new THREE.CylinderGeometry(r, r, len, 4, 1, true), material,
    (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, _dir.normalize());
  return m;
}

// A five-pointed star outline ([u, y] points) of outer radius r, point up, centred on (0, 0)
function starOutline(r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.4 : r;
    pts.push([Math.cos(a) * k, Math.sin(a) * k]);
  }
  return pts;
}

function buildDworzecLandmarks({ group, colliders, M }) {
  // ---------------------------------------------------------------------------------------------------------------
  // Poznań Główny (2012, the "Zintegrowane Centrum Komunikacyjne" station hall): a 7,000 m² glazed box on the deck over
  // platforms 1–5, ~2 storeys, under a thin white flat roof that overhangs the glass on every side; widely mocked as a
  // "bus shelter". Roof edge ≈ 13 m above the street deck, its ridge rooflight 13.6 m (estimated from photos: two ~5 m
  // hall storeys plus the roof slab and its upstand). Local -z faces north (Most Dworcowy), +x east towards Avenida.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const W = 71;
    const D = 44.3;
    // Glass hall, set 2 m in under the roof overhang; the ground storey a little further in (the deck edge)
    box(obj, W - 6, 5, D - 6, M.facade.glassBlue, 0, 0, 0);
    box(obj, W - 4, 6, D - 4, M.facade.glassBlue, 0, 5, 0);
    // White steel: the floor slab between the storeys and the mullion fins on the long sides
    box(obj, W - 3.6, 0.6, D - 3.6, M.plasterWhite, 0, 5, 0);
    for (let x = -W / 2 + 4; x <= W / 2 - 4 + 0.01; x += 6.3) {
      box(obj, 0.35, 11, 0.8, M.plasterWhite, x, 0, -D / 2 + 1.6);
      box(obj, 0.35, 11, 0.8, M.plasterWhite, x, 0, D / 2 - 1.6);
    }
    for (let z = -D / 2 + 4; z <= D / 2 - 4 + 0.01; z += 6.05) {
      box(obj, 0.8, 11, 0.35, M.plasterWhite, -W / 2 + 1.6, 0, z);
      box(obj, 0.8, 11, 0.35, M.plasterWhite, W / 2 - 1.6, 0, z);
    }
    // The canopy roof: a thin white slab over the whole site with a raised fascia, and a low rooflight strip
    box(obj, W, 1.2, D, M.plasterWhite, 0, 11, 0);
    box(obj, W, 0.8, 0.4, M.plasterWhite, 0, 12.2, -D / 2 + 0.2);
    box(obj, W, 0.8, 0.4, M.plasterWhite, 0, 12.2, D / 2 - 0.2);
    box(obj, 0.4, 0.8, D, M.plasterWhite, -W / 2 + 0.2, 12.2, 0);
    box(obj, 0.4, 0.8, D, M.plasterWhite, W / 2 - 0.2, 12.2, 0);
    pitchedRoof(obj, W - 16, 6, 1.4, M.glass, 0, 12.2, 0, { ridge: 'x' });
    // Entrance canopy on the north (Most Dworcowy) side, under the roof overhang
    box(obj, 18, 0.5, 2.5, M.plasterWhite, 0, 4.2, -D / 2 + 2);
    group.add(obj);
    collider(colliders, -W / 2 + 3, W / 2 - 3, -D / 2 + 3, D / 2 - 3, 11);
    fitToSite([obj], site('Poznań Główny'), colliders, c0, { height: 13.6 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Stary Dworzec (the old station building, 1874–79, finished by 1906; ticket hall closed 2013): a through station
  // between the tracks, its front wing with the central hall facing north up ul. Dworcowa towards the Kaponiera, and two
  // long side wings running south around two inner courtyards. Red clinker facades (pl.wikipedia "Poznań Główny"),
  // two storeys (~11 m eaves) under low slate roofs; the central hall pavilion rises to ~19 m (estimated from photos).
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const W = 48.9;
    const D = 142.9;
    const zN = -D / 2;
    const zS = D / 2;
    const EAVES = 10.5;
    // Front wing (north), 20 m deep, with the taller hall pavilion in its middle
    box(obj, W, EAVES, 20, M.facade.brick, 0, 0, zN + 10);
    pitchedRoof(obj, W, 20, 3, M.slate, 0, EAVES, zN + 10, { ridge: 'x', hip: 0.6 });
    box(obj, 20, 15, 23, M.brick, 0, 0, zN + 11.5);
    box(obj, 21, 0.8, 24, M.sandstone, 0, 15, zN + 11.5); // cornice
    pitchedRoof(obj, 20, 23, 3.5, M.slate, 0, 15.8, zN + 11.5, { ridge: 'z' });
    // The hall's tall arched windows and the clock on the north gable
    for (const x of [-6, 0, 6]) {
      profileSlab(obj, [[-1.8, 0], [1.8, 0], [1.8, 6], [1.27, 7.27], [0, 7.8], [-1.27, 7.27], [-1.8, 6]], 0.3, M.glass,
        x, 4, zN - 0.05);
    }
    profileSlab(obj, [[-10, 0], [10, 0], [0, 3.4]], 0.6, M.sandstone, 0, 15.8, zN - 0.2); // pediment on the gable
    cylinder(obj, 1.1, 1.1, 0.2, 16, M.warmLit, 0, 12.3, zN - 0.15).rotation.x = Math.PI / 2;
    for (const x of [-10.5, 10.5]) box(obj, 1.2, 15.4, 1.2, M.sandstone, x, 0, zN + 0.1); // pavilion pilasters
    // Side wings along the tracks (platforms 5/3/2 east, 8/10/11 west), 10 m deep
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 5);
      box(obj, 10, EAVES, D - 20, M.facade.brick, x, 0, 10);
      pitchedRoof(obj, 10, D - 20, 2.5, M.slate, x, EAVES, 10, { ridge: 'z' });
    }
    // Cross wings closing the two courtyards, and the south end wing
    for (const z of [10, zS - 8]) {
      box(obj, W - 20, EAVES - 1.5, 16, M.facade.brick, 0, 0, z);
      pitchedRoof(obj, W - 20, 16, 2.5, M.slate, 0, EAVES - 1.5, z, { ridge: 'x' });
    }
    // Cornice band at the eaves of the long walls
    for (const s of [-1, 1]) box(obj, 0.5, 0.6, D, M.sandstone, s * (W / 2 - 0.1), EAVES - 0.6, 0);
    group.add(obj);
    collider(colliders, -W / 2, W / 2, zN, zN + 20, EAVES);
    collider(colliders, -W / 2, -W / 2 + 10, zN + 20, zS, EAVES);
    collider(colliders, W / 2 - 10, W / 2, zN + 20, zS, EAVES);
    collider(colliders, -W / 2 + 10, W / 2 - 10, 2, 18, EAVES);
    collider(colliders, -W / 2 + 10, W / 2 - 10, zS - 16, zS, EAVES);
    fitToSite([obj], site('Stary Dworzec'), colliders, c0, { height: 19.3 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Avenida (opened 2013 as Poznań City Center, renamed 2016): a 386 m long mall beside platform 1, three retail
  // storeys of white panels and glass under a two-level car park on its roof (open decks behind concrete parapets)
  // with stair/lift towers. Roof parapet ≈ 22 m (estimated: 3 × 5 m retail + 2 × 3 m parking decks + parapet). The OSM
  // outline is full width for its northern half, then its east side runs diagonally in to x ≈ -7 at the south end.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const X0 = -47.8;
    const X1 = 47.8;
    const Z0 = -193;
    const ZT = 9; // where the diagonal east side starts
    const Z1 = 193;
    const eastAt = (z) => (z <= ZT ? X1 : X1 + ((z - ZT) / (Z1 - ZT)) * (-7 - X1));
    // Masses: the full-width northern half, then the tapering south half in steps that follow the diagonal
    const masses = [[ZT - (ZT - Z0), ZT, X1]];
    const STEPS = 5;
    for (let i = 0; i < STEPS; i++) {
      const za = ZT + ((Z1 - ZT) * i) / STEPS;
      const zb = ZT + ((Z1 - ZT) * (i + 1)) / STEPS;
      masses.push([za, zb, eastAt((za + zb) / 2)]);
    }
    for (const [za, zb, xe] of masses) {
      const w = xe - X0;
      const cx = (X0 + xe) / 2;
      const cz = (za + zb) / 2;
      const d = zb - za;
      // Retail storeys: white-panel facade with a glass band at the top storey
      box(obj, w, 10, d, M.facade.concrete, cx, 0, cz);
      box(obj, w, 5, d, M.facade.glassBlue, cx, 10, cz);
      // Car park decks: dark open storeys between concrete slabs and parapets, slightly set back
      box(obj, w - 2, 2.2, d - 2, M.darkMetal, cx, 15, cz);
      box(obj, w - 1, 1.1, d - 1, M.concrete, cx, 17.2, cz);
      box(obj, w - 2, 2.2, d - 2, M.darkMetal, cx, 18.3, cz);
      box(obj, w - 1, 1.2, d - 1, M.concrete, cx, 20.5, cz);
      collider(colliders, X0, xe, za, zb, 21.7);
    }
    // Glazed entrance halls at both ends, a storey taller than the retail block
    box(obj, 40, 16, 6, M.facade.glassBlue, -10, 0, Z0 + 3);
    box(obj, 34, 16, 6, M.facade.glassBlue, X0 + 18, 0, Z1 - 3);
    box(obj, 42, 0.8, 8, M.plasterWhite, -10, 16, Z0 + 4);
    // Stair and lift towers of the roof car park, and its ramp
    for (const z of [-150, -60, 30, 120]) box(obj, 6, 3.6, 6, M.concrete, X0 + 6, 21.7, z);
    for (const z of [-110, -20]) box(obj, 6, 3.6, 6, M.concrete, X1 - 6, 21.7, z);
    // Car-park lamp posts on the top deck
    for (let z = -180; z <= 170; z += 40) {
      const xe = Math.min(eastAt(z + 10), X1) - 8;
      for (let x = X0 + 15; x < xe; x += 30) box(obj, 0.2, 3.6, 0.2, M.darkMetal, x, 21.7, z);
    }
    group.add(obj);
    fitToSite([obj], site('Avenida'), colliders, c0, { height: 25.3 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Stary Browar (the Hugger brewery, 1870s–1900s, rebuilt as an art & shopping centre 2003, extended with the Pasaż
  // 2007; ul. Półwiejska 42): red brick ranges of 4–6 storeys along both long sides of the lot, joined by brick cross
  // wings, with glass-roofed atria between them; the old brewery tower and the tall brick chimney stand in the western
  // (Półwiejska, local -x) half, the Pasaż's glass-banded brick blocks in the east. Heights estimated from photos:
  // ranges 18–24 m, brewery tower ≈ 36 m, chimney ≈ 42 m (the landmark's top).
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const X0 = -109;
    const X1 = 96.5; // the main block's east end; a narrower strip runs on to 109 along the north side
    const ZN = -33.3;
    const ZS = 33.3;
    // North range (-z): old brewery 5 storeys west of the entrance notch, Pasaż east of it
    box(obj, 150, 21, 16, M.facade.brick, X0 + 75, 0, ZN + 8);
    box(obj, 13.5, 14, 9, M.facade.glassDark, 47.7, 0, ZN + 11.5); // north entrance in the outline's notch
    box(obj, 54.5, 18, 21, M.facade.brick, 54.5 + 27.25, 0, ZN + 10.5);
    box(obj, 54.5, 2.4, 21, M.facade.glassDark, 54.5 + 27.25, 18, ZN + 10.5); // Pasaż: glazed top storey
    box(obj, 55, 0.6, 21.5, M.clinker, 54.5 + 27.25, 20.4, ZN + 10.5);
    // South range (+z)
    box(obj, 147, 24, 16, M.facade.brick, X0 + 73.5, 0, ZS - 8);
    box(obj, 27, 14, 11, M.facade.glassDark, 51.5, 0, ZS - 12.5); // south entrance in the notch
    box(obj, 31.5, 18, 16, M.facade.brick, 65 + 15.75, 0, ZS - 8);
    box(obj, 31.5, 2.4, 16, M.facade.glassDark, 65 + 15.75, 18, ZS - 8);
    box(obj, 32, 0.6, 16.5, M.clinker, 65 + 15.75, 20.4, ZS - 8);
    // Cross wings: the Półwiejska front, two in the middle, the east end
    for (const [x, w, h] of [[X0 + 8, 16, 22], [-30, 12, 20], [30, 10, 18], [X1 - 7, 14, 18]]) {
      box(obj, w, h, ZS - ZN - 32, M.facade.brick, x, 0, 0);
    }
    // Stepped brick gable on the Półwiejska front, over the west wing
    profileSlab(obj, [[-15, 0], [15, 0], [15, 2], [10, 2], [10, 4], [5, 4], [5, 6], [-5, 6], [-5, 4], [-10, 4], [-10, 2],
      [-15, 2]], 1, M.clinker, X0 + 8, 22, 0, Math.PI / 2);
    // Glass atrium roofs (steel-framed ridge lights) over the three courts between the cross wings
    for (const [xa, xb, h] of [[X0 + 16, -36, 19], [-24, 25, 17], [35, X1 - 14, 16]]) {
      const w = xb - xa;
      pitchedRoof(obj, w, ZS - ZN - 32, 3, M.glass, (xa + xb) / 2, h, 0, { ridge: 'x' });
      for (let x = xa + 4; x < xb; x += 8) box(obj, 0.3, 0.3, ZS - ZN - 32, M.steel, x, h + 0.2, 0);
    }
    // Cornices of clinker along the brick ranges
    box(obj, 150, 0.8, 16.6, M.clinker, X0 + 75, 21, ZN + 8);
    box(obj, 147, 0.8, 16.6, M.clinker, X0 + 73.5, 24, ZS - 8);
    // The narrow north-east annex reaching to the lot's east edge
    box(obj, 12.5, 15, 22, M.facade.brick, X1 + 6.25, 0, ZN + 11);
    // The brewery tower: square brick shaft with a clinker belfry and a slate pyramid helmet
    const TX = -30;
    const TZ = ZN + 8;
    box(obj, 9, 30, 9, M.brick, TX, 0, TZ);
    box(obj, 9.8, 1, 9.8, M.clinker, TX, 23, TZ);
    for (const s of [-1, 1]) {
      box(obj, 2.2, 4.2, 0.3, M.glass, TX, 24.6, TZ + s * 4.55);
      box(obj, 0.3, 4.2, 2.2, M.glass, TX + s * 4.55, 24.6, TZ);
    }
    box(obj, 9.8, 0.8, 9.8, M.clinker, TX, 30, TZ);
    pitchedRoof(obj, 9.8, 9.8, 5.2, M.slate, TX, 30.8, TZ, { hip: 1 });
    // The brewery chimney in the Art courtyard: tapering round brick stack on a square clinker plinth
    const CX = -48;
    const CZ = 2;
    box(obj, 5, 8, 5, M.clinker, CX, 0, CZ);
    cylinder(obj, 1.5, 2.3, 33, 16, M.brick, CX, 8, CZ);
    cylinder(obj, 1.85, 1.85, 1.2, 16, M.clinker, CX, 38, CZ);
    cylinder(obj, 1.7, 1.7, 2.8, 16, M.brick, CX, 39.2, CZ);
    group.add(obj);
    collider(colliders, X0, X0 + 150, ZN, ZN + 16, 21);
    collider(colliders, 54.5, 109, ZN, ZN + 21, 18);
    collider(colliders, X0, X0 + 147, ZS - 16, ZS, 24);
    collider(colliders, 65, X1, ZS - 16, ZS, 18);
    collider(colliders, X0, X1 - 14, ZN + 16, ZS - 16, 16);
    collider(colliders, X1 - 14, X1, ZN + 16, ZS - 16, 18);
    collider(colliders, 41, 65, ZN, ZS, 14);
    fitToSite([obj], site('Stary Browar'), colliders, c0, { height: 42 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Iglica (1955, Bolesław Szmidt): the 70 m openwork steel spire, symbol of the Międzynarodowe Targi Poznańskie
  // (Grupa MTP architectural record: "Licząca 70 m wysokości iglica", measurement point unspecified; reconstructed
  // 1954–1955 on Poelzig's 1911 water tower base), rising from Pawilon 11, the round two-storey hall. Pavilion ≈ 11 m
  // with a set-back drum; the spire a square steel lattice tapering with a concave profile from ~9 m across at the roof
  // to a mast and star at 70 m.
  // ---------------------------------------------------------------------------------------------------------------
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const R = 28.4;
    // The rotunda: a 16-sided drum, a glass band at the upper storey, a set-back upper drum and a flat roof
    cylinder(obj, R, R, 6.5, 16, M.plasterCream, 0, 0, 0);
    cylinder(obj, R - 0.2, R - 0.2, 3, 16, M.glass, 0, 6.5, 0);
    cylinder(obj, R + 0.3, R + 0.3, 0.9, 16, M.plasterWhite, 0, 9.5, 0);
    cylinder(obj, 16, 16, 2.2, 16, M.plasterCream, 0, 10.4, 0);
    cylinder(obj, 16.4, 16.4, 0.4, 16, M.plasterWhite, 0, 12.6, 0);
    // Four entrances, recessed into the drum in the OSM outline: glazed portals under flat canopies
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      box(obj, 10.4, 6.5, 4.6, M.glass, sx * (R - 2.2), 0, sz * (R - 2.2), a);
      box(obj, 11, 0.4, 4.4, M.plasterWhite, sx * (R - 2.2), 5.6, sz * (R - 2.2), a);
    }
    // The spire: four corner legs, a ring of horizontals and X bracing every panel; half-width follows a concave
    // curve from 4.5 m at the roof (y 13) to 0.35 m at y 64, where the mast takes over
    const Y0 = 13;
    const Y1 = 64;
    const PANELS = 14;
    const half = (y) => 0.35 + 4.15 * Math.pow((Y1 - y) / (Y1 - Y0), 1.7);
    const corners = (y) => {
      const h = half(y);
      return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]];
    };
    let lower = corners(Y0);
    for (let p = 1; p <= PANELS; p++) {
      // Panels get shorter towards the top, like the real lattice's diminishing bays
      const t = p / PANELS;
      const y = Y0 + (Y1 - Y0) * (1 - Math.pow(1 - t, 1.35));
      const upper = corners(y);
      const rLeg = 0.28 - 0.18 * t;
      const rBrace = 0.09;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        strut(obj, lower[k], upper[k], rLeg, M.steel);
        strut(obj, upper[k], upper[k2], rBrace, M.steel);
        strut(obj, lower[k], upper[k2], rBrace, M.steel);
        strut(obj, lower[k2], upper[k], rBrace, M.steel);
      }
      lower = upper;
    }
    // Legs' footing plinth on the roof, the mast, a small orb and the star
    box(obj, 10.5, 0.6, 10.5, M.concrete, 0, 12.6, 0);
    cylinder(obj, 0.12, 0.22, 4, 6, M.steel, 0, Y1, 0);
    cylinder(obj, 0.35, 0.35, 0.3, 8, M.steel, 0, Y1 + 3.8, 0);
    const STAR = starOutline(1.1);
    profileSlab(obj, STAR, 0.18, M.gold, 0, Y1 + 4.9, 0);
    profileSlab(obj, STAR, 0.18, M.gold, 0, Y1 + 4.9, 0, Math.PI / 2);
    group.add(obj);
    collider(colliders, -R * 0.92, R * 0.92, -R * 0.38, R * 0.38, 10.4);
    collider(colliders, -R * 0.38, R * 0.38, -R * 0.92, R * 0.92, 10.4);
    collider(colliders, -R * 0.75, R * 0.75, -R * 0.75, R * 0.75, 10.4);
    fitToSite([obj], site('Iglica'), colliders, c0, { height: 70 });
  }
}

export { buildDworzecLandmarks };
