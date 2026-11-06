import * as THREE from 'three/webgpu';
import { box, cylinder, lathe, pitchedRoof, profileSlab, collider, fitToSite } from './landmark-kit.js';
import { LANDMARK_SITES } from './city-config.js';

// Measured heights (m) from GUGiK ISOK LiDAR DSM − DTM queries (docs/observations/landmarks-2026-11-05.md)
const RACZYNSKI = { top: 18.6 };
const DZIALYNSKI = { top: 22.25 };
const BAZAR = { top: 24.4 };
const MUZEUM = { top: 26.0 };
const TEATR_PL = { top: 23.9 };
const MAIUS = { top: 36.4 };
const BERNARDYNI = { top: 44.7 };
const FRANCISZKANIE = { top: 32.6 };
const NMP = { top: 28.8 };
const WOJCIECH = { top: 23.9 };
const BOZE_CIALO = { top: 39.5 };

const site = (name) => LANDMARK_SITES[name];

function buildHistoricLandmarks({ group, colliders, M }) {
  // --- Biblioteka Raczyńskich ----------------------------------------------------------------------------------------
  // Neoclassical library building on Plac Wolności (1822–1828). Monumental 24-column Corinthian colonnade inspired
  // by the Louvre East Colonnade, facing south onto Plac Wolności (+z). Interior roof top reaches 18.6 m (eaves 14.5 m).
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 39.6, d = 16.0;
    // Rusticated ground floor base
    box(obj, w, 4.0, d, M.facade.sandstone, 0, 0, 0);
    // Recessed upper block behind the south colonnade
    box(obj, w - 0.8, 10.5, d - 2.0, M.facade.plasterCream, 0, 4.0, -0.9);
    // Colonnade: 24 stone columns along south facade front facing Plac Wolności (+z)
    const nCols = 24;
    const colStep = (w - 3.6) / (nCols - 1);
    for (let i = 0; i < nCols; i++) {
      cylinder(obj, 0.38, 0.44, 10.5, 10, M.stoneGrey, -w / 2 + 1.8 + i * colStep, 4.0, d / 2 - 0.6);
    }
    // Entablature beam spanning above columns
    box(obj, w, 1.2, 2.0, M.sandstone, 0, 14.5, d / 2 - 0.9);
    // Attic balustrade screen
    box(obj, w, 1.2, d, M.plasterWhite, 0, 15.7, 0);
    // Low zinc hipped roof reaching interior top 18.6 m
    pitchedRoof(obj, w - 1.0, d - 1.0, 1.7, M.zinc, 0, 16.9, 0, { hip: 0.8 });

    group.add(obj);
    collider(colliders, -w / 2, w / 2, -d / 2, d / 2, RACZYNSKI.top);
    fitToSite([obj], site('Biblioteka Raczyńskich'), colliders, c0, { height: RACZYNSKI.top });
  }

  // --- Pałac Działyńskich --------------------------------------------------------------------------------------------
  // Late Baroque-Classicist palace on Stary Rynek 78 (1773–1776). Front facade faces east onto Stary Rynek (+x),
  // crowned by an attic with a sculpture of a pelican feeding its young at 22.25 m (LiDAR peak at the east end).
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 49.0, d = 19.7;
    // Ground floor base and upper storeys along the plot
    box(obj, w, 4.0, d, M.facade.sandstone, 0, 0, 0);
    box(obj, w, 11.8, d, M.facade.plasterCream, 0, 4.0, 0);
    // French mansard slate roof
    pitchedRoof(obj, w - 0.6, d - 0.6, 4.7, M.slate, 0, 15.8, 0, { hip: 0.65 });
    // East frontispiece and attic screen on Stary Rynek (+x)
    box(obj, 3.0, 1.6, 14.0, M.plasterWhite, w / 2 - 1.5, 15.8, 0);
    // Triangular pediment facing east onto Stary Rynek
    pitchedRoof(obj, 3.0, 14.0, 2.0, M.sandstone, w / 2 - 1.5, 17.4, 0, { ridge: 'x', hip: 0 });
    // Pelican sculpture on pedestal at the east front
    cylinder(obj, 0.6, 0.7, 1.4, 10, M.stoneGrey, w / 2 - 1.5, 17.8, 0);
    lathe(obj, [[0, 0], [0.7, 0.8], [0.4, 1.8], [0.1, 3.05]], 12, M.gold, w / 2 - 1.5, 19.2, 0);

    group.add(obj);
    collider(colliders, -w / 2, w / 2, -d / 2, d / 2, DZIALYNSKI.top);
    fitToSite([obj], site('Pałac Działyńskich'), colliders, c0, { height: DZIALYNSKI.top });
  }

  // --- Hotel Bazar ---------------------------------------------------------------------------------------------------
  // Historic hotel on Al. Marcinkowskiego / Paderewskiego. Prominent curved corner rotunda with Baroque copper dome
  // reaching 24.4 m at the northeast corner (+x, -z), and L-shaped wings along Paderewskiego and Marcinkowskiego.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 71.1, d = 38.6;
    // North wing along Paderewskiego
    box(obj, w, 5.0, 14.0, M.facade.sandstone, 0, 0, -12.3);
    box(obj, w, 13.3, 14.0, M.facade.sandstone, 0, 5.0, -12.3);
    pitchedRoof(obj, w, 14.0, 3.0, M.slate, 0, 18.3, -12.3, { hip: 0.5 });
    // South wing along Marcinkowskiego
    box(obj, 36.0, 5.0, 24.0, M.facade.sandstone, -17.55, 0, 6.7);
    box(obj, 36.0, 13.3, 24.0, M.facade.sandstone, -17.55, 5.0, 6.7);
    pitchedRoof(obj, 36.0, 24.0, 3.0, M.slate, -17.55, 18.3, 6.7, { hip: 0.5 });
    // Corner rotunda and Baroque copper dome at northeast (+x, -z)
    const rotX = w / 2 - 3.5, rotZ = -d / 2 + 3.5;
    cylinder(obj, 5.2, 5.4, 18.3, 16, M.sandstone, rotX, 0, rotZ);
    cylinder(obj, 4.8, 5.0, 2.5, 16, M.sandstone, rotX, 18.3, rotZ);
    lathe(obj, [[4.8, 0], [5.0, 0.8], [4.4, 2.0], [2.2, 3.0], [0.1, 3.6]], 16, M.copper, rotX, 20.8, rotZ);

    group.add(obj);
    collider(colliders, -w / 2, w / 2, -19.3, -5.3, BAZAR.top);
    collider(colliders, -35.5, 0.4, -5.3, 18.7, 21.3);
    fitToSite([obj], site('Hotel Bazar'), colliders, c0, { height: BAZAR.top });
  }

  // --- Muzeum Narodowe (Gmach Główny) ---------------------------------------------------------------------------------
  // Historic museum on Al. Marcinkowskiego. Monumental historic building stands at the south end (+z, Paderewskiego)
  // reaching 26.0 m with central attic pediment facing south (ridge 'z'), with lower exhibition halls to the north.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 63.4, dMain = 44.0;
    // South historic main building on Paderewskiego (+z)
    box(obj, w, 5.5, dMain, M.granite, 0, 0, 49.0);
    box(obj, w, 10.5, dMain, M.facade.sandstone, 0, 5.5, 49.0);
    pitchedRoof(obj, w, dMain, 5.0, M.zinc, 0, 16.0, 49.0, { hip: 0.4 });
    // Monumental historic attic pavilion with pediment on Marcinkowskiego/Paderewskiego (+z, -x, lidar top at u -17, w 48)
    box(obj, 20.0, 7.5, 12.0, M.sandstone, -17.0, 16.0, 48.0);
    pitchedRoof(obj, 20.0, 12.0, 2.5, M.copper, -17.0, 23.5, 48.0, { ridge: 'z', hip: 0 });
    // North exhibition halls extending toward Marcinkowskiego
    box(obj, 50.0, 13.5, 96.0, M.facade.plasterCream, -1.0, 0, -23.0);
    pitchedRoof(obj, 50.0, 96.0, 4.0, M.zinc, -1.0, 13.5, -23.0, { hip: 0.5 });

    group.add(obj);
    collider(colliders, -w / 2, w / 2, 27.0, 71.0, MUZEUM.top);
    collider(colliders, -26.0, 24.0, -71.0, 27.0, 17.5);
    fitToSite([obj], site('Muzeum Narodowe'), colliders, c0, { height: MUZEUM.top });
  }

  // --- Teatr Polski --------------------------------------------------------------------------------------------------
  // Classicist theatre on ul. 27 Grudnia (1873–1875). Hexastyle portico with pediment facing south (+z) onto 27 Grudnia
  // (ridge 'z'), with the high stage fly tower and auditorium block at the north strip (-z) reaching 23.9 m.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 27.3, d = 40.1;
    // Foyer block in the south section
    box(obj, w, 14.5, 18.0, M.facade.plasterCream, 0, 0, 11.0);
    pitchedRoof(obj, w, 18.0, 2.7, M.zinc, 0, 14.5, 11.0, { hip: 0.6 });
    // Hexastyle entrance portico facing south (+z) onto ul. 27 Grudnia
    for (let i = 0; i < 6; i++) {
      cylinder(obj, 0.4, 0.45, 11.5, 10, M.stoneGrey, -8.0 + i * 3.2, 0, 20.0);
    }
    box(obj, 18.0, 1.2, 3.5, M.sandstone, 0, 11.5, 20.0);
    pitchedRoof(obj, 18.0, 3.5, 3.8, M.sandstone, 0, 12.7, 20.0, { ridge: 'z', hip: 0 });
    // Stage fly tower and auditorium block in the north strip (-z)
    box(obj, 24.0, 18.5, 22.0, M.facade.plasterCream, 0, 0, -9.0);
    pitchedRoof(obj, 24.0, 22.0, 5.4, M.slate, 0, 18.5, -9.0, { hip: 0.35 });

    group.add(obj);
    collider(colliders, -w / 2, w / 2, -d / 2, d / 2, TEATR_PL.top);
    fitToSite([obj], site('Teatr Polski'), colliders, c0, { height: TEATR_PL.top });
  }

  // --- Collegium Maius -----------------------------------------------------------------------------------------------
  // Neo-Renaissance palace facing ul. Fredry / Park Mickiewicza (1905–1908). Colossal Ionic portico and central octagonal
  // lantern dome (36.4 m) stand in the south section (+z) facing Fredry, with side wings extending north.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const w = 90.4, d = 69.2;
    // Main 3-storey south section along ul. Fredry (+z)
    box(obj, w, 16.5, 26.0, M.facade.sandstone, 0, 0, 10.0);
    pitchedRoof(obj, w, 26.0, 6.5, M.tileRed, 0, 16.5, 10.0, { hip: 0.3 });
    // Side wings extending north around courtyard (-z)
    box(obj, 24.0, 16.5, 46.0, M.facade.sandstone, -w / 2 + 12.0, 0, -14.0);
    pitchedRoof(obj, 24.0, 46.0, 6.5, M.tileRed, -w / 2 + 12.0, 16.5, -14.0, { hip: 0.5 });
    box(obj, 24.0, 16.5, 46.0, M.facade.sandstone, w / 2 - 12.0, 0, -14.0);
    pitchedRoof(obj, 24.0, 46.0, 6.5, M.tileRed, w / 2 - 12.0, 16.5, -14.0, { hip: 0.5 });
    // Central avant-corps and Ionic portico facing south with pediment (ridge 'z')
    box(obj, 30.0, 21.0, 28.0, M.sandstone, 0, 0, 10.0);
    pitchedRoof(obj, 30.0, 6.0, 6.5, M.sandstone, 0, 21.0, 21.0, { ridge: 'z', hip: 0 });
    // Octagonal masonry drum, Baroque copper dome, and lantern (36.4 m) in south part
    cylinder(obj, 8.2, 8.6, 5.5, 8, M.sandstone, 0, 21.0, 10.0);
    lathe(obj, [[8.2, 0], [8.0, 2.5], [5.0, 4.8], [1.6, 5.5]], 16, M.copper, 0, 26.5, 10.0);
    cylinder(obj, 1.5, 1.6, 2.6, 8, M.copper, 0, 32.0, 10.0);
    cylinder(obj, 0.1, 1.4, 1.8, 8, M.copper, 0, 34.6, 10.0);

    group.add(obj);
    collider(colliders, -w / 2, w / 2, -3.0, 24.0, MAIUS.top);
    collider(colliders, -w / 2, -w / 2 + 24.0, -36.0, -3.0, 23.0);
    collider(colliders, w / 2 - 24.0, w / 2, -36.0, -3.0, 23.0);
    fitToSite([obj], site('Collegium Maius'), colliders, c0, { height: MAIUS.top });
  }

  // --- Kościół św. Franciszka Serafickiego (Bernardyni) -------------------------------------------------------------
  // Monumental Late-Baroque basilica on Plac Bernardyński (1661–1730s). High nave (30.9 m ridge) runs E–W along the
  // site's long axis (x), with twin 44.7 m Baroque towers at the west end on Garbary (-x).
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const lenNave = 76.0, wNave = 18.0;
    // High nave and clerestory walls running E-W along x
    box(obj, lenNave, 19.0, wNave, M.plasterCream, 0, 0, -10.0);
    pitchedRoof(obj, lenNave, wNave, 11.9, M.tileRed, 0, 19.0, -10.0, { ridge: 'x' });
    // Multi-tier Baroque facade screen with volutes at west front
    box(obj, 3.5, 35.1, 26.0, M.plasterWhite, -36.3, 0, -10.0);
    // Twin Baroque facade towers at west front on Garbary (-x)
    for (const dz of [-6.0, 6.0]) {
      box(obj, 6.8, 32.0, 6.8, M.plasterCream, -34.6, 0, -10.0 + dz);
      lathe(obj, [[3.4, 0], [3.8, 2.2], [2.4, 5.2], [1.5, 7.8], [1.8, 9.6], [0.1, 12.7]], 16, M.copper, -34.6, 32.0, -10.0 + dz);
    }
    // Adjoining monastery quadrangle wing on south side (+z); shortened to 30.0 m length to stay clear of Garbary roadway
    const lenWing = 30.0, wWing = 19.0;
    box(obj, lenWing, 13.0, wWing, M.facade.plasterCream, -lenWing / 2, 0, 8.5);
    pitchedRoof(obj, lenWing, wWing, 4.5, M.tileRed, -lenWing / 2, 13.0, 8.5, { hip: 0.5 });

    group.add(obj);
    collider(colliders, -38.0, 38.0, -19.0, -1.0, BERNARDYNI.top);
    collider(colliders, -lenWing, 0.0, -1.0, 18.0, 17.5);
    fitToSite([obj], site('Kościół Bernardynów'), colliders, c0, { height: BERNARDYNI.top });
  }

  // --- Kościół św. Antoniego Padewskiego (Franciszkanie) -------------------------------------------------------------
  // Baroque church on Przemysł Hill on ul. Franciszkańska (1674–1728). Nave runs along the east side (+x), with twin
  // spires (32.6 m) 16 m apart east of centre per LiDAR, and adjoining Franciscan convent building on the west (-x).
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const wNave = 22.0, lenNave = 42.0;
    // Church nave on east side (+x)
    box(obj, wNave, 16.5, lenNave, M.facade.plasterCream, 12.0, 0, 0);
    pitchedRoof(obj, wNave, lenNave, 8.0, M.tileRed, 12.0, 16.5, 0, { ridge: 'z' });
    // Baroque north facade with volutes
    box(obj, 22.0, 26.0, 3.0, M.plasterWhite, 12.0, 0, -21.0);
    // Twin octagonal openwork copper spires 16 m apart east of centre (x = 4 and 20)
    for (const tx of [4.0, 20.0]) {
      cylinder(obj, 2.5, 2.7, 24.0, 8, M.plasterCream, tx, 0, -19.5);
      cylinder(obj, 0.1, 2.4, 8.6, 8, M.copper, tx, 24.0, -19.5);
    }
    // Adjoining Franciscan convent building on the west slope (-x)
    box(obj, 24.0, 12.5, 20.0, M.facade.plasterCream, -13.0, 0, -10.0);
    pitchedRoof(obj, 24.0, 20.0, 4.5, M.tileRed, -13.0, 12.5, -10.0, { hip: 0.4 });

    group.add(obj);
    collider(colliders, 1.0, 23.0, -22.0, 21.0, FRANCISZKANIE.top);
    collider(colliders, -25.0, 1.0, -20.0, 0.0, 17.0);
    fitToSite([obj], site('Kościół Franciszkanów'), colliders, c0, { height: FRANCISZKANIE.top });
  }

  // --- Kościół Najświętszej Marii Panny (in Summo) -------------------------------------------------------------------
  // 15th-century Gothic brick hall church on Ostrów Tumski (Hanusz Prusz, 1431–1448). Nave runs E–W along local x
  // matching site dimensions; stepped tracery gables at east and west ends, Gothic ridge reaching 28.8 m.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const len = 23.0, w = 15.0;
    // Brick hall body running E-W along x
    box(obj, len, 14.5, w, M.brick, 0, 0, 0);
    // Steep Gothic red tile roof along x
    pitchedRoof(obj, len, w, 14.3, M.tileRed, 0, 14.5, 0, { ridge: 'x' });
    // Stepped Gothic gables at east (+x) and west (-x) ends with traceried blind niches
    const gableProfile = [
      [-7.5, 14.5], [7.5, 14.5],
      [7.5, 18.0], [6.0, 18.0], [6.0, 22.0], [4.3, 22.0],
      [4.3, 25.5], [2.5, 25.5], [0, 28.8],
      [-2.5, 25.5], [-4.3, 25.5], [-4.3, 22.0],
      [-6.0, 22.0], [-6.0, 18.0], [-7.5, 18.0]
    ];
    profileSlab(obj, gableProfile, 1.2, M.clinker, -len / 2, 0, 0, Math.PI / 2);
    profileSlab(obj, gableProfile, 1.2, M.clinker, len / 2, 0, 0, Math.PI / 2);
    // Brick buttresses along the aisles
    for (const dx of [-8.0, 0, 8.0]) {
      box(obj, 1.4, 13.0, 1.0, M.brick, dx, 0, -w / 2 - 0.5);
      box(obj, 1.4, 13.0, 1.0, M.brick, dx, 0, w / 2 + 0.5);
    }

    group.add(obj);
    collider(colliders, -len / 2 - 1.0, len / 2 + 1.0, -w / 2 - 1.0, w / 2 + 1.0, NMP.top);
    fitToSite([obj], site('Kościół Najświętszej Marii Panny'), colliders, c0, { height: NMP.top });
  }

  // --- Kościół św. Wojciecha (Skałka Poznańska) ----------------------------------------------------------------------
  // Gothic church on Wzgórze św. Wojciecha. Nave runs E–W along local x with 23.9 m Renaissance volute gable on the
  // west facade (-x), and historic freestanding wooden belfry in the churchyard.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const len = 32.0, w = 15.0;
    // Gothic brick nave and chancel running E-W along x
    box(obj, len, 12.0, w, M.brick, 0, 0, -2.0);
    pitchedRoof(obj, len, w, 7.5, M.tileRed, 0, 12.0, -2.0, { ridge: 'x' });
    // Renaissance volute gable on west front (-x)
    box(obj, 1.5, 4.0, w, M.plasterWhite, -len / 2, 12.0, -2.0);
    profileSlab(obj, [
      [-w / 2, 16.0], [w / 2, 16.0],
      [w / 2 - 1.8, 19.5], [w / 2 - 3.8, 22.0], [0, 23.9],
      [-w / 2 + 3.8, 22.0], [-w / 2 + 1.8, 19.5]
    ], 1.2, M.plasterCream, -len / 2, 0, -2.0, Math.PI / 2);
    // Freestanding wooden belfry in the churchyard
    box(obj, 7.0, 8.8, 7.0, M.wood, 4.0, 0, 9.5);
    pitchedRoof(obj, 7.4, 7.4, 3.2, M.slate, 4.0, 8.8, 9.5, { hip: 1 });

    group.add(obj);
    collider(colliders, -len / 2 - 1.0, len / 2 + 1.0, -w / 2 - 2.0, w / 2 - 2.0, WOJCIECH.top);
    collider(colliders, 0.5, 7.5, 6.0, 13.0, 12.0);
    fitToSite([obj], site('Kościół św. Wojciecha'), colliders, c0, { height: WOJCIECH.top });
  }

  // --- Kościół Bożego Ciała ------------------------------------------------------------------------------------------
  // Massive Gothic brick basilica founded by Władysław Jagiełło (1406). Nave runs E–W along local x with 7-tier stepped
  // pinnacle gable at the west facade (-x) and central copper flèche reaching 39.5 m at mid-length.
  {
    const c0 = colliders.length;
    const obj = new THREE.Group();
    const len = 58.0, wAisle = 26.0, wNave = 14.0;
    // Side aisles running E-W along x
    box(obj, len, 11.5, wAisle, M.brick, 0, 0, 4.0);
    pitchedRoof(obj, len, wAisle, 5.0, M.tileRed, 0, 11.5, 4.0, { ridge: 'x' });
    // Clerestory nave
    box(obj, len, 19.0, wNave, M.brick, 0, 0, 4.0);
    pitchedRoof(obj, len, wNave, 12.0, M.tileRed, 0, 19.0, 4.0, { ridge: 'x' });
    // 7-tier stepped Gothic pinnacle gable on west facade (-x)
    profileSlab(obj, [
      [-wNave / 2 - 2.0, 19.0], [wNave / 2 + 2.0, 19.0],
      [wNave / 2 + 2.0, 22.0], [wNave / 2, 22.0], [wNave / 2, 25.5], [wNave / 2 - 1.8, 25.5],
      [wNave / 2 - 1.8, 29.0], [wNave / 2 - 3.5, 29.0], [wNave / 2 - 3.5, 32.0], [0, 34.0],
      [-wNave / 2 + 3.5, 32.0], [-wNave / 2 + 3.5, 29.0], [-wNave / 2 + 1.8, 29.0],
      [-wNave / 2 + 1.8, 25.5], [-wNave / 2, 25.5], [-wNave / 2, 22.0],
      [-wNave / 2 - 2.0, 22.0]
    ], 1.6, M.clinker, -len / 2, 0, 4.0, Math.PI / 2);
    // Slender copper flèche / spire at nave ridge crossing mid-length
    cylinder(obj, 0.1, 1.4, 8.5, 8, M.copper, 1.0, 31.0, 4.0);

    group.add(obj);
    collider(colliders, -len / 2 - 1.0, len / 2 + 1.0, -9.0, 17.0, BOZE_CIALO.top);
    fitToSite([obj], site('Kościół Bożego Ciała'), colliders, c0, { height: BOZE_CIALO.top });
  }
}

export { buildHistoricLandmarks };
