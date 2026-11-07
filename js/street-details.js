import * as THREE from 'three/webgpu';
import { Fn, float, color, uniform, mod, fract, step, smoothstep, mix, uv, texture, attribute, vec2, floor, sin, positionWorld } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGNAL_SITES, SIGNAL_PLANS, updateSignal, JUNCTIONS, blockAt, BLOCKS, nearestRoads, roadClearance, LANDMARK_SITES, createTreeWallChecker } from './city-config.js';
import { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK } from './road-network.js';
import { cityUniforms, createTreeGrateMaterial } from './tsl-materials.js';
import { createTreeField, SPECIES_CROWN_R } from './trees.js';
import { pavedPlazaRects, parkTreeSites, parkLampSites, clearOfRails } from './city-grid.js';

// js/street-details.js
// Poznań street furniture, instanced (docs/world.md "New kind of street furniture"):
// - S-1 three-aspect signal heads on poles at each corner of the signalised junctions (city-config.js SIGNAL_SITES),
//   facing the traffic arriving over each arm, with red / green figure pedestrian heads facing across it
// - street name plates on the corner buildings of those junctions
// - LED bent-mast streetlights along the curbs (tall on main streets, lower on side streets), historic gas lanterns
//   in the Old Town and on Ostrów Tumski
// - tall red hydrants, Poczta Polska post boxes, parking machines and bollards along the curbs; press and flower
//   kiosks and advertising columns (słupy ogłoszeniowe) where the sidewalk is wide
// - park and street trees, and the pooled street lights that follow the camera
// Every prop but the trees is an obstacle footprint (lanes and walkers keep clear) and a player collider; the trees'
// trunks are player colliders only.

// Pedestrian head faces: a standing figure in the top cell, a walking one in the bottom, white on black (a mask)
function createPedestrianFigureTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  const limb = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const head = (x, y) => {
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  };
  // standing
  head(64, 22);
  ctx.fillRect(51, 37, 26, 46);
  limb(47, 44, 44, 80);
  limb(81, 44, 84, 80);
  limb(57, 84, 57, 118);
  limb(71, 84, 71, 118);
  // walking
  head(68, 150);
  limb(66, 166, 61, 204);
  limb(65, 172, 47, 194);
  limb(65, 172, 84, 189);
  limb(61, 204, 44, 242);
  limb(61, 204, 82, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Street name plates after Poznań's System Informacji Miejskiej (2017 city information system manual, pp. 41-51;
// zdm.poznan.pl "Nowe tablice ulicowe"): graphite RAL 7043 with white type set left, the street kind as a full
// lowercase word on a small top line ("ulica", "aleja", "rondo"; a patron's given names and titles go up there too), the
// name large below it, and a blue RAL 5005 strip along the bottom with the district in capitals. Two sizes: 0.315 x
// 0.22 m in the Old Town and on narrow streets, 0.67 x 0.35 m elsewhere; one atlas cell per label and size.
const PLATE_SIZES = { small: { w: 0.315, h: 0.22, cell: [180, 126] }, large: { w: 0.67, h: 0.35, cell: [256, 134] } };
function createPlateAtlas(labels, [cw, ch]) {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const ctx = c.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  // the largest size up to `size` at which `text` fits `width`
  const fit = (text, weight, size, width) => {
    ctx.font = font(weight, size);
    while (size > 8 && ctx.measureText(text).width > width) ctx.font = font(weight, --size);
    return size;
  };
  labels.forEach(({ kind, name, district }, i) => {
    const x0 = (i % cols) * cw;
    const y0 = Math.floor(i / cols) * ch;
    const pad = Math.round(cw * 0.06);
    const strip = Math.round(ch * 0.2); // ~70 mm on the large plate, ~45 mm on the small
    ctx.fillStyle = '#3b3d3f';
    ctx.fillRect(x0, y0, cw, ch);
    ctx.fillStyle = '#1f5bb5';
    ctx.fillRect(x0, y0 + ch - strip, cw, strip);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const top = Math.round(ch * 0.17);
    if (kind) {
      fit(kind, 500, top, cw - 2 * pad);
      ctx.fillText(kind, x0 + pad, y0 + pad + top * 0.8);
    }
    const big = fit(name, 500, Math.round(ch * 0.36), cw - 2 * pad);
    ctx.fillText(name, x0 + pad, y0 + ch - strip - Math.max(pad * 0.7, (ch - strip - pad - top - big) * 0.35));
    if (district) {
      const label = district.toUpperCase();
      fit(label, 500, Math.round(strip * 0.55), cw - 2 * pad);
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x0 + pad, y0 + ch - strip / 2 + 1);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cols, rows };
}

// A street's plate lines: { kind (the small top line), name (the large one), district }. "Aleje Karola Marcinkowskiego"
// -> "aleje Karola" over "Marcinkowskiego"; squares, roundabouts and bridges take their own word, places named by
// their kind ("Stary Rynek", "Rynek Jeżycki", "Zaułek Ślepego Antka", "Wzgórze Przemysła") none. The HUD plate in
// main.js uses it too.
const PLATE_KINDS = { aleja: 'aleja', aleje: 'aleje', rondo: 'rondo', plac: 'plac', osiedle: 'osiedle', most: 'most',
  skwer: 'skwer', park: 'park', bulwar: 'bulwar', 'wybrzeże': 'wybrzeże' };
// given names (genitive) and titles that go on the top line before the surname
const PATRON_WORDS = new Set(('Adama Aleksandra Andrzeja Anny Antoniego Arcybiskupa Arnolda Augusta Biskupa Bolesława ' +
  'Edwarda Emilii Ewarysta Feliksa Floriana Franciszka Franklina Fryderyka Generała Grzegorza Gustawa Henryka Ignacego ' +
  'Jakuba Jana Janusza Jarosława Jerzego Józefa Karola Kazimierza Księcia Księdza Króla Królowej Ludwika Marcina Marii ' +
  'Marszałka Michała Mikołaja Pawła Piotra Prymasa Romana Ryszarda Stanisława Stefana Świętego Świętej Tadeusza ' +
  'Władysława Wojciecha Zygmunta i').split(' '));
const UNPLATED_KINDS = new Set(['Zaułek', 'Pasaż', 'Wzgórze']);
function plateLabel(name, district) {
  const words = name.split(/\s+/);
  let kind = 'ulica';
  const first = words[0].toLowerCase();
  if (PLATE_KINDS[first] && words.length > 1) {
    kind = PLATE_KINDS[first];
    words.shift();
  } else if (/\bRynek\b/.test(name) || UNPLATED_KINDS.has(words[0])) kind = '';
  // the patron's given names and titles up top, the surname (with any numeral, "Mieszka I") large
  let k = 0;
  while (k < words.length - 1 && PATRON_WORDS.has(words[k])) k++;
  if (k === words.length - 1 && /^[IVX]+$/.test(words[k])) k--;
  const head = words.slice(0, Math.max(0, k)).join(' ');
  return { kind: [kind, head].filter(Boolean).join(' '), name: words.slice(Math.max(0, k)).join(' '), district: district || '' };
}

// Advertising column posters: a seeded patchwork of bills (no text), wrapped round the column
function createPosterTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const inks = ['#e8e1cf', '#d23b2e', '#f2c230', '#2b5fa8', '#1d1d1f', '#e77a2d', '#5f9e4a', '#f4f0e6', '#8a3a7a'];
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#d9d2bf';
  ctx.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512;) {
    const w = 46 + Math.floor(rnd() * 50);
    for (let y = 6; y < 250;) {
      const h = 50 + Math.floor(rnd() * 70);
      ctx.fillStyle = inks[Math.floor(rnd() * inks.length)];
      ctx.fillRect(x + 2, y, w - 4, Math.min(h, 250 - y) - 4);
      // a band or block of colour standing in for the bill's headline and picture
      ctx.fillStyle = inks[Math.floor(rnd() * inks.length)];
      ctx.fillRect(x + 6, y + 6, w - 12, Math.max(6, Math.floor(h * (0.15 + rnd() * 0.35))));
      y += h;
    }
    x += w;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Each head carries a stable texture coordinate into the shared CPU signal cache. Culling copies the instance
// attribute, so a pedestrian request still reaches its heads after the original meshes have been chunked.
function createTrafficSignalLensMaterial(isAvenueHead, stateTexture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const state = texture(stateTexture, vec2(attribute('signalIndex', 'float'), 0.5));
    const phase = (isAvenueHead ? state.r : state.g).mul(255);
    const band = (v) => step(v - 0.5, phase).sub(step(v + 0.5, phase));
    const greenActive = band(1);
    const amberActive = band(2).add(band(4));
    const redActive = band(3).add(band(4));
    const lamp = uv().y;
    const isTopRed = step(0.75, lamp);
    const isBottomGreen = float(1.0).sub(step(0.25, lamp));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));
    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));
    const lensHue = mix(mix(color(0x18ff68), color(0xffaa10), isMidAmber), color(0xff2424), isTopRed);
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

function createWalkSignalMaterial(clock, isAvenue, figureTex, stateTexture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const state = texture(stateTexture, vec2(attribute('signalIndex', 'float'), 0.5));
    const display = (isAvenue ? state.b : state.a).mul(255);
    const enabled = float(1).sub(step(2.5, display));
    const greenPhase = step(0.5, display).mul(enabled);
    const flashing = step(1.5, display);
    const greenLit = greenPhase.mul(mix(float(1), step(0.5, fract(clock)), flashing));
    const isRed = step(0.5, uv().y);
    const lit = mix(greenLit, float(1).sub(greenPhase), isRed).mul(enabled);
    const hue = mix(color(0x30ff8c), color(0xff2a20), isRed);
    const mask = texture(figureTex, uv()).r;
    return mix(color(0x0d0f11), mix(hue.mul(0.08), hue.mul(1.4), lit), mask);
  })();
  return mat;
}

function buildStreetDetails(scene, opts = {}) {
  const { buildingColliders = [], grid, propColliders = grid?.propColliders } = opts;
  const group = new THREE.Group();
  group.name = 'StreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of (`kind` is for measuring)
  const footprints = [];
  const addFootprint = (x, z, w, d, kind = 'other') =>
    footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, kind });
  // Player colliders (controllers.js: static boxes, bucketed into its 48 m cells), as tight as the visible shaft or
  // cabinet: an upright box of half widths hx, hz up to maxY
  const colliders = [];
  const addCollider = (x, z, hx, hz, maxY) => {
    const c = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, maxY };
    colliders.push(c);
    return c;
  };

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);
  // One RGBA8 texel per plan: the two vehicle phases and the two pedestrian display states. Only changed state
  // uploads (about 2 KB for the whole city), with no new buffers or allocations in the frame loop.
  const signalState = new Uint8Array(Math.max(1, SIGNAL_PLANS.length) * 4);
  const signalTexture = new THREE.DataTexture(signalState, Math.max(1, SIGNAL_PLANS.length), 1, THREE.RGBAFormat);
  signalTexture.magFilter = THREE.NearestFilter;
  signalTexture.minFilter = THREE.NearestFilter;
  signalTexture.generateMipmaps = false;
  const phaseCode = { off: 0, green: 1, amber: 2, red: 3, redAmber: 4 };
  function updateSignalTexture() {
    let changed = false;
    for (const timing of SIGNAL_PLANS) {
      const state = updateSignal(signalClock.value, timing);
      const i = timing.index * 4;
      const a = phaseCode[state.phase0], b = phaseCode[state.phase1];
      const c = state.disabled ? 3 : state.displayWalk0, d = state.disabled ? 3 : state.displayWalk1;
      if (signalState[i] === a && signalState[i + 1] === b && signalState[i + 2] === c && signalState[i + 3] === d) continue;
      signalState[i] = a;
      signalState[i + 1] = b;
      signalState[i + 2] = c;
      signalState[i + 3] = d;
      changed = true;
    }
    if (changed) signalTexture.needsUpdate = true;
  }
  updateSignalTexture();

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b4046, roughness: 0.45, metalness: 0.78 });
  // galvanised signal poles
  const signalPoleMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.7 });
  const signalHousingMat = new THREE.MeshStandardNodeMaterial({
    color: 0x1c1f22, // black / dark grey housings
    roughness: 0.55,
    metalness: 0.25,
    side: THREE.DoubleSide // the visors are open half-tubes
  });
  const backplateBorderMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2c400, roughness: 0.4, metalness: 0.1 });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalTexture);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalTexture);
  const figureTex = createPedestrianFigureTexture();
  const aveWalkMat = createWalkSignalMaterial(signalClock, true, figureTex, signalTexture);
  const streetWalkMat = createWalkSignalMaterial(signalClock, false, figureTex, signalTexture);
  // LED luminaire lens and gas lantern glass: pale by day, lit after dusk (the gas a warmer, yellower white)
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const gasGlassGlow = new THREE.MeshBasicNodeMaterial();
  gasGlassGlow.colorNode = mix(color(0xc9ccc4), color(0xffdc9a).mul(1.9), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const castIronMat = new THREE.MeshStandardNodeMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0.55 });
  // the plates' aluminium tray, graphite RAL 7043 like their face
  const plateBackMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b3d3f, roughness: 0.5, metalness: 0.4 });

  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  // Lens and panel geometry carries its lamp in uv.y (see the lens materials): a constant, or the panel's own
  // 0..1 squeezed into the half from `lo`
  const lampUV = (geo, v, lo = null) => {
    const a = geo.getAttribute('uv');
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i), lo === null ? v : lo + a.getY(i) * 0.5);
    return geo;
  };

  // S-1 vehicle head (origin at its centre, facing +z): a 200 mm three-lamp housing with a visor over each lamp and a
  // bracket back to the pole; the bigger heads on main roads get a backplate with a yellow border
  const S1_PITCH = 0.27;
  const S1_R = 0.1;
  const S1_LAMPS = [[S1_PITCH, 1], [0, 0.5], [-S1_PITCH, 0]];
  const s1HousingGeo = mergeGeometries([
    new THREE.BoxGeometry(0.3, 0.86, 0.22),
    new THREE.BoxGeometry(0.08, 0.5, 0.2).translate(0, 0, -0.2),
    ...S1_LAMPS.map(([y]) => new THREE.CylinderGeometry(S1_R + 0.025, S1_R + 0.025, 0.16, 12, 1, true, Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2).translate(0, y, 0.19))
  ].map((g) => g.toNonIndexed()));
  const s1LensGeo = mergeGeometries(S1_LAMPS.map(([y, v]) => lampUV(new THREE.CircleGeometry(S1_R, 16), v).translate(0, y, 0.112)));
  const backplateGeo = new THREE.BoxGeometry(0.44, 1.0, 0.014).translate(0, 0, -0.112);
  const backplateBorderGeo = new THREE.BoxGeometry(0.54, 1.1, 0.012).translate(0, 0, -0.118);
  // Pedestrian head (facing +z): two square chambers, red figure over green, each under a hood
  const pedHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(0.3, 0.6, 0.2),
    new THREE.BoxGeometry(0.08, 0.4, 0.18).translate(0, 0, -0.18),
    new THREE.BoxGeometry(0.28, 0.02, 0.12).translate(0, 0.275, 0.16),
    new THREE.BoxGeometry(0.28, 0.02, 0.12).translate(0, -0.015, 0.16)
  ].map((g) => g.toNonIndexed()));
  const pedPanelGeo = mergeGeometries([
    lampUV(new THREE.PlaneGeometry(0.24, 0.24), 0, 0.5).translate(0, 0.145, 0.101),
    lampUV(new THREE.PlaneGeometry(0.24, 0.24), 0, 0).translate(0, -0.145, 0.101)
  ]);

  // LED bent mast (origin at the foot, reaching along +x; scale 1 is the 10 m main-street pole): a tapered shaft, a bend
  // out to a short horizontal arm, and a flat luminaire with its lens underneath
  const bend = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 8.6, 0), new THREE.Vector3(0, 9.7, 0), new THREE.Vector3(0.35, 10.0, 0), new THREE.Vector3(1.65, 10.0, 0)
  );
  const bentMastGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.065, 0.1, 8.6, 10).translate(0, 4.3, 0),
    new THREE.CylinderGeometry(0.14, 0.14, 0.5, 10).translate(0, 0.25, 0),
    new THREE.TubeGeometry(bend, 12, 0.055, 8, false)
  ].map((g) => g.toNonIndexed()));
  const LED_REACH = 2.05; // luminaire centre from the pole
  const ledHousingGeo = new THREE.BoxGeometry(0.8, 0.1, 0.32).translate(LED_REACH, 9.99, 0);
  const ledLensGeo = new THREE.PlaneGeometry(0.66, 0.22).rotateX(Math.PI / 2).translate(LED_REACH, 9.935, 0);
  // Historic gas lantern (origin at the foot): an octagonal cast-iron base, a fluted shaft with a collar, the
  // lamplighter's ladder bar under the lantern, a four-sided glass lantern wider at the top, a roof and a finial
  const gasPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
    new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8).translate(0, 0.74, 0),
    new THREE.CylinderGeometry(0.055, 0.08, 2.55, 10).translate(0, 2.0, 0),
    new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10).translate(0, 1.2, 0),
    new THREE.BoxGeometry(0.66, 0.04, 0.04).translate(0, 3.05, 0),
    new THREE.CylinderGeometry(0.15, 0.05, 0.16, 4).rotateY(Math.PI / 4).translate(0, 3.36, 0),
    new THREE.CylinderGeometry(0.02, 0.3, 0.2, 4).rotateY(Math.PI / 4).translate(0, 4.0, 0),
    new THREE.SphereGeometry(0.04, 8, 6).translate(0, 4.14, 0)
  ].map((g) => g.toNonIndexed()));
  const gasGlassGeo = new THREE.CylinderGeometry(0.23, 0.15, 0.48, 4).rotateY(Math.PI / 4).translate(0, 3.68, 0);

  // =========================================================================
  // 1. SIGNAL HEADS AT THE SIGNALISED JUNCTIONS
  //    One pole on the right-hand curb of every arm traffic arrives over, just behind the crosswalk (by the stop
  //    line), carrying the S-1 head facing that traffic and a pedestrian head facing across the arm; one on
  //    the left-hand curb (or median) with the pedestrian head facing back, and a repeater S-1 head on wide arms.
  //    Arms of one road (within ~35° of one line: both ways, or a divided road's two roadways) are one signal group,
  //    and the widest road is group 0, as road-network.js step 7 ranks them; people crossing an arm walk with the
  //    other group's traffic (traffic.js walkOn). Poles stand only on curb islands, clear of the lanes.
  // =========================================================================
  const signalPoleMatrices = [];
  const s1Matrices = [];
  const s1AveMatrices = [];
  const s1StreetMatrices = [];
  const backplateMatrices = [];
  const pedHeadMatrices = [];
  const pedAveMatrices = [];
  const pedStreetMatrices = [];
  const s1AveIndices = [], s1StreetIndices = [], pedAveIndices = [], pedStreetIndices = [];
  const audioSignals = [];
  const signalArmPoles = new Map();
  const vehicleHeadSites = [];
  const plateSites = []; // { x, z, nx, nz, label }
  const ledLampSites = [];
  const streetPointSites = [];
  // Every placed pole, post and kiosk centre, hashed in POLE_CELL cells: isClearOfPoles runs for every candidate site,
  // and scanning all the poles took 0.8 s of the 1.5 s street-furniture build over the 8.2 × 5.7 km box (25k sites)
  const POLE_CELL = 8;
  const poleCells = new Map();
  const poleKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
  const addPole = (p) => {
    const k = poleKey(Math.floor(p.x / POLE_CELL), Math.floor(p.z / POLE_CELL));
    const list = poleCells.get(k);
    if (list) list.push(p);
    else poleCells.set(k, [p]);
  };

  const plazaRects = pavedPlazaRects || [];
  const inPlaza = (x, z, m = 1.0, exact = true) => plazaRects.some((r) => {
    if (x <= r.minX - m || x >= r.maxX + m || z <= r.minZ - m || z >= r.maxZ + m) return false;
    if (!exact || !r.ring) return true;
    // A park's bounds can span several streets (the Rataje island covers 0.7 × 1.7 km). Keep its actual outline,
    // including the margin at each edge, rather than suppressing furniture on unrelated sidewalks in that box.
    let inside = false;
    for (let i = 0, j = r.ring.length - 1; i < r.ring.length; j = i++) {
      const a = r.ring[j], b = r.ring[i];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
      if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) <= m) return true;
    }
    return inside;
  });

  // True only when (x, z) and its surrounding pad-meter footprint sit on a real curb island (never in a road or median)
  const isOnCurbIsland = (x, z, pad = 0.55) => {
    const b = blockAt(x, z);
    if (!b || b.median) return false;
    if (pad <= 0) return true;
    const b1 = blockAt(x - pad, z);
    const b2 = blockAt(x + pad, z);
    const b3 = blockAt(x, z - pad);
    const b4 = blockAt(x, z + pad);
    return !!(b1 && !b1.median && b2 && !b2.median && b3 && !b3.median && b4 && !b4.median);
  };

  // True only when (x, z) is on a non-park, non-median, non-plaza sidewalk with `pad` clearance from all curbs
  const isOnSidewalk = (x, z, pad = 0.55) => {
    if (!isOnCurbIsland(x, z, pad)) return false;
    const b = blockAt(x, z);
    return !(b.park > 0.6) && !inPlaza(x, z, 1.0);
  };

  const isClearOfPoles = (x, z, minDist = 6.0) => {
    const md2 = minDist * minDist;
    const i1 = Math.floor((x + minDist) / POLE_CELL);
    const j0 = Math.floor((z - minDist) / POLE_CELL);
    const j1 = Math.floor((z + minDist) / POLE_CELL);
    for (let i = Math.floor((x - minDist) / POLE_CELL); i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = poleCells.get(poleKey(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const dx = list[k].x - x;
          const dz = list[k].z - z;
          if (dx * dx + dz * dz < md2) return false;
        }
      }
    }
    return true;
  };

  // Lanes are laid out along the road graph's runs (road-network.js: from merged junction centres, at the links' own
  // widths), which in places reach past a block's curb outline, most near junctions: a prop of radius r also keeps
  // outside them (city-config.js roadClearance), with 0.3 m for the runs' shape nodes straying from the real bends
  const clearOfRoads = (x, z, r) => roadClearance(x, z) >= r + 0.3;

  // Crosswalk landings: pedestrian-routes.js runs each arm's crosswalk 2 m onto both sidewalks (with 0.4 m to spare
  // each side) at the crosswalk road-paint.js paints STOP_SETBACK beyond its stop line, and drops a crosswalk with any
  // footprint on it. The stop line is where the arm clears the roads crossing it (road-network.js stopBack, with the arms
  // the graph gives here) plus the CROSSWALK and STOP_SETBACK; signal poles 1-4 m past the corner closed 41 crosswalks,
  // bollards 8. A bend (two arms in about one line) has none. Landings are kept free across the whole crosswalk depth and
  // 2.6 m behind the curb: the curb island's, which the crosswalk runs on to where it lies up to CROSSWALK_REACH beyond
  // the arm's width (pedestrian-routes.js), found the same way here.
  const LANDING_CELL = 64;
  const landingGrid = new Map(); // cell -> [{ x, z, ux, uz, left, right, mid }]
  for (const j of JUNCTIONS) {
    const arms = j.arms;
    if (arms.length === 2 && arms[0].ux * arms[1].ux + arms[0].uz * arms[1].uz < -0.82) continue;
    for (const a of arms) {
      let ext = 0;
      for (const b of arms) {
        const cos = a.ux * b.ux + a.uz * b.uz;
        const sin = Math.abs(a.ux * b.uz - a.uz * b.ux);
        if (b === a || cos > 0.94 || (cos < 0 && sin < 0.26)) continue; // merging, or the same road going on
        ext = Math.max(ext, (b.w / 2 + (a.w / 2) * Math.abs(cos)) / sin);
      }
      const mid = (ext > 0 ? Math.min(ext, 20) + CROSSWALK + STOP_SETBACK : 2) - STOP_SETBACK - CROSSWALK / 2;
      // how far each landing lies past the arm's curb lines (+ along (uz, -ux), the side the lateral offset counts up)
      const reach = (sign) => {
        const x = j.x + a.ux * mid + a.uz * sign * a.w / 2, z = j.z + a.uz * mid - a.ux * sign * a.w / 2;
        for (let d = 0; d <= CROSSWALK_REACH; d += 0.25) if (blockAt(x + a.uz * sign * d, z - a.ux * sign * d)) return d;
        return 0;
      };
      const l = { x: j.x, z: j.z, ux: a.ux, uz: a.uz, left: a.w / 2 + reach(-1), right: a.w / 2 + reach(1), mid };
      const ix = Math.floor((j.x + a.ux * mid) / LANDING_CELL);
      const iz = Math.floor((j.z + a.uz * mid) / LANDING_CELL);
      const k = ix * 100000 + iz;
      if (!landingGrid.has(k)) landingGrid.set(k, []);
      landingGrid.get(k).push(l);
    }
  }
  const clearOfCrosswalks = (x, z, r) => {
    const ix0 = Math.floor(x / LANDING_CELL);
    const iz0 = Math.floor(z / LANDING_CELL);
    for (let ix = ix0 - 1; ix <= ix0 + 1; ix++) {
      for (let iz = iz0 - 1; iz <= iz0 + 1; iz++) {
        for (const l of landingGrid.get(ix * 100000 + iz) || []) {
          const ox = x - l.x;
          const oz = z - l.z;
          const along = ox * l.ux + oz * l.uz;
          const side = ox * l.uz - oz * l.ux;
          if (Math.abs(along - l.mid) < CROSSWALK / 2 + r && side > -l.left - 2.6 - r && side < l.right + 2.6 + r) return false;
        }
      }
    }
    return true;
  };

  // A signal pole may stand on a sidewalk 0.4 m clear of its curb, or in the middle of a median at least 1.8 m wide
  // (0.9 m clear: lanes keep LANE_CLEAR 1.2 m from their centrelines, which stand >= 1.2 m inside the curbs), 0.8 m
  // outside the nearest roadway (0.35 m left a few poles in lanes)
  const signalPoleSpot = (x, z, exactPark = false) => {
    const b = blockAt(x, z);
    if (!b || b.underpass || inPlaza(x, z, 0.5, exactPark) || !isClearOfPoles(x, z, 1.4) || !clearOfRoads(x, z, 0.5) ||
      !clearOfCrosswalks(x, z, 0.15) || !clearOfRails(x, z, 0.22)) return false;
    const pad = b.median ? 0.9 : 0.4;
    for (const [ox, oz] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) {
      const q = blockAt(x + ox, z + oz);
      if (!q || !!q.median !== !!b.median) return false;
    }
    return true;
  };

  const cross = (ax, az, bx, bz) => ax * bz - az * bx;
  const setFacing = (x, y, z, fx, fz) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, Math.atan2(fx, fz), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  const SIGNAL_POLE_H = 4.2;
  const S1_Y = 3.55; // head centre: its red lamp at 3.82 m, the green at 3.28 m
  const PED_Y = 2.45;
  const signalHeadMatrix = (p, a) => setFacing(p.x + a.ux * 0.18, S1_Y, p.z + a.uz * 0.18, a.ux, a.uz);
  // Overhead mast-arm heads for approaches whose curb has no pole site. The head centre at 5.3 m leaves
  // 0.47 m below the 5.8 m tram contact wire; a 6.2 m mast or a 4.1-6.2 m sleeve on a reused pole carries the
  // 5.55 m arm over the nearest lane.
  const OVERHEAD_Y = 5.3;
  const OVERHEAD_MAST_H = 6.2;
  const OVERHEAD_ARM_Y = 5.55;
  const OVERHEAD_ARM_R = 0.045;
  const OVERHEAD_REACH = 12;
  const armDir = new THREE.Vector3();
  const armUp = new THREE.Vector3(0, 1, 0);
  const armQuat = new THREE.Quaternion();

  function addSignalPole(p) {
    addPole(p);
    addFootprint(p.x, p.z, 0.3, 0.3, 'signal');
    addCollider(p.x, p.z, 0.08, 0.08, 0.1 + SIGNAL_POLE_H);
    dummy.position.set(p.x, 0.1 + SIGNAL_POLE_H / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.055, SIGNAL_POLE_H, 0.055);
    dummy.updateMatrix();
    signalPoleMatrices.push(dummy.matrix.clone());
  }
  // Thicker mast for an overhead head: the same footprint/collider machinery, a taller shaft and a horizontal arm
  // reaching over the arriving lane. Only the foot is a player obstacle; the arm and head clear all road users.
  function addOverheadPole(p) {
    addPole(p);
    addFootprint(p.x, p.z, 0.36, 0.36, 'signal');
    addCollider(p.x, p.z, 0.1, 0.1, 0.1 + OVERHEAD_MAST_H);
    dummy.position.set(p.x, 0.1 + OVERHEAD_MAST_H / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.08, OVERHEAD_MAST_H, 0.08);
    dummy.updateMatrix();
    signalPoleMatrices.push(dummy.matrix.clone());
  }
  function addSignalArm(p, head) {
    const dx = head.x - p.x, dz = head.z - p.z, len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    armDir.set(dx / len, 0, dz / len);
    armQuat.setFromUnitVectors(armUp, armDir);
    dummy.position.set((p.x + head.x) / 2, OVERHEAD_ARM_Y, (p.z + head.z) / 2);
    dummy.quaternion.copy(armQuat);
    dummy.scale.set(OVERHEAD_ARM_R, len, OVERHEAD_ARM_R);
    dummy.updateMatrix();
    signalPoleMatrices.push(dummy.matrix.clone());
    dummy.rotation.set(0, 0, 0);
  }
  // A reused 4.2 m signal pole needs a sleeve up to the 5.55 m arm; the existing footing and collider stay as they are.
  function addMastExtension(p) {
    dummy.position.set(p.x, 4.1 + (OVERHEAD_MAST_H - 4.1) / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.06, OVERHEAD_MAST_H - 4.1, 0.06);
    dummy.updateMatrix();
    signalPoleMatrices.push(dummy.matrix.clone());
  }
  function addPedestrianHead(p, fx, fz, isAvenue, timing) {
    const x = p.x + fx * 0.17, z = p.z + fz * 0.17;
    const m = setFacing(x, PED_Y, z, fx, fz);
    const signalIndex = (timing.index + 0.5) / Math.max(1, SIGNAL_PLANS.length);
    pedHeadMatrices.push(m);
    (isAvenue ? pedAveMatrices : pedStreetMatrices).push(m);
    (isAvenue ? pedAveIndices : pedStreetIndices).push(signalIndex);
    audioSignals.push({ x, y: PED_Y, z, isAvenue, signalTiming: timing });
  }

  const builtJunctions = new Set();
  for (const site of SIGNAL_SITES) {
    if (builtJunctions.has(site.junction)) continue;
    builtJunctions.add(site.junction);
    // Route pruning happens after furniture construction. Always build the same poles and footprints when a
    // world is rebuilt; its final walking network later disables the lenses and audio through the shared plan.
    const signalIndex = (site.timing.index + 0.5) / Math.max(1, SIGNAL_PLANS.length);
    const arms = site.arms || [];
    // Use the plan's original axis for heads and vehicles alike. Transitive angle clustering can join a curved
    // third arm to the main road even when its own direction belongs to the other phase.

    arms.forEach((a) => {
      const group0 = Math.abs(a.ux * site.timing.mainUx + a.uz * site.timing.mainUz) > 0.82;
      const half = a.w / 2;
      const rx = a.uz; // right of the traffic arriving over the arm (it travels along -u)
      const rz = -a.ux;
      // The corner: how far out along the arm its curbs clear the curbs of the roads crossing it
      let corner = 0;
      for (const b of arms) {
        if (b === a || Math.abs(a.ux * b.ux + a.uz * b.uz) > 0.82) continue;
        const den = cross(a.ux, a.uz, b.ux, b.uz);
        for (const side of [1, -1]) {
          for (const bs of [1, -1]) {
            const px = a.x + rx * half * side;
            const pz = a.z + rz * half * side;
            const qx = b.x + b.uz * (b.w / 2) * bs;
            const qz = b.z - b.ux * (b.w / 2) * bs;
            const t = cross(qx - px, qz - pz, b.ux, b.uz) / den;
            const s = cross(qx - px, qz - pz, a.ux, a.uz) / den;
            if (t > corner && t < 35 && s > -1) corner = t;
          }
        }
      }
      // Behind the crosswalk (CROSSWALK 4.3 m from the corner), by the stop line STOP_SETBACK further on, as Polish
      // signals stand: first in the gap between them, then level with the line and back from it. road-network.js runs
      // its turning curves from stop line to stop line and they cut the corners, so a pole 1-4 m past the corner stood
      // within a curve's 0.8 m clearance at 58 corners and cost 4.2 km of the network; further back along the curb only
      // the lanes pass it
      // The western and eastern Krucza approaches lie inside a park's bounds but outside its actual island.
      // The eastern approach requires dt >= 6.0 m to clear the right-turn curve into Zamenhofa (which at 4.8 m
      // blocked the turn and dropped the incoming edge).
      // Extending exact polygon outlines restores missing heads on sidewalks bordering parks across the city.
      // Unblocked approaches search from dt >= 6.0 m to clear turning curves (pathClear 0.8 m); Szelągowska requires
      // dt >= 8.4 m and Miliana dt >= 7.2 m to clear adjacent lanes, while Baraniaka drops side 1 to keep lane clearance.
      const isKruczaWest = Math.hypot(site.x - 700.6, site.z - 2745.7) < 1 && a.inbound && a.ux < -0.9;
      const isKruczaEast = Math.hypot(site.x - 700.6, site.z - 2745.7) < 1 && a.inbound && a.ux > 0.9;
      const isSzelagowska = Math.hypot(site.x - 397.0, site.z + 961.9) < 2 && a.name === 'Szelągowska';
      const isBaraniaka = Math.hypot(site.x - 3312.5, site.z - 1386.2) < 2 && a.name === 'Arcybiskupa Antoniego Baraniaka';
      const isMiliana = Math.hypot(site.x - 1378.6, site.z - 964.1) < 2 && a.name === 'Jerzego Miliana';
      const spot = (side) => {
        if (isBaraniaka && side === 1) return null;
        for (const back of [0.75, 1.0, 1.3]) {
          const minDt = isKruczaEast ? 6.0 : (CROSSWALK + 0.5);
          for (let dt = minDt; dt < 16; dt += 1.2) {
            const t = corner + dt;
            const x = a.x + a.ux * t + rx * (half + back) * side;
            const z = a.z + a.uz * t + rz * (half + back) * side;
            if (signalPoleSpot(x, z, isKruczaWest || isKruczaEast)) return { x, z };
          }
        }
        const exactMinDt = (isSzelagowska && side === 1) ? 8.4 : ((isMiliana && side === -1) ? 7.2 : 6.0);
        for (const back of [0.75, 1.0, 1.3]) {
          for (let dt = exactMinDt; dt < 16; dt += 1.2) {
            const t = corner + dt;
            const x = a.x + a.ux * t + rx * (half + back) * side;
            const z = a.z + a.uz * t + rz * (half + back) * side;
            if (signalPoleSpot(x, z, true)) return { x, z };
          }
        }
        return null;
      };
      const big = a.w >= 14.5 || a.lanes >= 3;
      let rightPole = false;
      const armPoles = [];
      signalArmPoles.set(a, { site, poles: armPoles, hasHead: false });
      for (const side of [1, -1]) {
        const p = spot(side);
        if (!p) continue;
        if (side === 1) rightPole = true;
        addSignalPole(p);
        armPoles.push({ side, p });
        // vehicle head facing the arriving traffic: on the right, and on the left as a repeater on wide arms, or as the
        // only head where the right curb has no spot for a pole (a tram track or a crosswalk landing in the way)
        if (a.inbound && (side === 1 || a.w >= 12 || a.lanes >= 3 || !rightPole)) {
          const m = signalHeadMatrix(p, a);
          s1Matrices.push(m);
          signalArmPoles.get(a).hasHead = true;
          vehicleHeadSites.push({ site, a, p, group0 });
          (group0 ? s1AveMatrices : s1StreetMatrices).push(m);
          (group0 ? s1AveIndices : s1StreetIndices).push(signalIndex);
          if (big) backplateMatrices.push(m);
        }
        // pedestrian head facing across the arm, for the people waiting on the other curb
        const fx = -rx * side;
        const fz = -rz * side;
        // these heads' WALK is the other group's; unplaced poles never become sound sources
        addPedestrianHead(p, fx, fz, !group0, site.timing);
      }
      // Street name plates for the corner buildings either side of the arm (1B)
      if (a.name) {
        for (const side of [1, -1]) {
          plateSites.push({ t: corner + 3.5, a, side });
        }
      }
    });
  }

  // The shared Dworzec zebra is generated after furniture, from two original same-phase arms. Their heads leave
  // its western refuge uncovered for walkers starting at the southern landing. This surveyed position is 6.68 m
  // from the rails and outside the actual refuge links (regression-tested with the completed walking network).
  // Register it before building that network so its shaft participates in obstacle and player collision checks.
  const dworzec = SIGNAL_SITES.find((site) => Math.hypot(site.x + 1566.1, site.z - 566.1) < 1);
  const refugePole = { x: -1580.5, z: 552 };
  if (dworzec && signalPoleSpot(refugePole.x, refugePole.z)) {
    const dx = -1557.93 - refugePole.x, dz = 579.52 - refugePole.z;
    const length = Math.hypot(dx, dz);
    addSignalPole(refugePole);
    addPedestrianHead(refugePole, dx / length, dz / length, false, dworzec.timing);
  }

  // =========================================================================
  // 1B. STREET NAME PLATES ON THE CORNER BUILDINGS
  //     From the curb just past each signalised corner, a ray across the sidewalk finds the first building wall
  //     (buildingColliders: the city-block and landmark colliders main.js hands over) within 14 m; the plate goes on
  //     it at 3.3 m, facing the street it names: the small Poznań SIM plate in the Old Town and on streets under 10 m,
  //     the large one elsewhere, with the block's district on the strip. Nearby plates of one name are dropped; with no
  //     colliders (tests) there are no plates.
  // =========================================================================
  const WALL_CELL = 24;
  const wallGrid = new Map();
  for (const c of buildingColliders) {
    if ((c.minY ?? 0) > 1 || c.maxY < 5) continue;
    for (let ix = Math.floor(c.minX / WALL_CELL); ix <= Math.floor(c.maxX / WALL_CELL); ix++) {
      for (let iz = Math.floor(c.minZ / WALL_CELL); iz <= Math.floor(c.maxZ / WALL_CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!wallGrid.has(k)) wallGrid.set(k, []);
        wallGrid.get(k).push(c);
      }
    }
  }
  // Entry of the ray o + d t (t > 0) into the box [-hx, hx] x [-hz, hz]: { t, ax (0 x, 1 z), s (the face's sign) }
  function slab(ox, oz, dx, dz, hx, hz) {
    let t0 = -Infinity;
    let t1 = Infinity;
    let ax = 0;
    let s = 1;
    for (const [o, d, h, axis] of [[ox, dx, hx, 0], [oz, dz, hz, 1]]) {
      if (Math.abs(d) < 1e-9) {
        if (o < -h || o > h) return null;
        continue;
      }
      const a = (-h - o) / d;
      const b = (h - o) / d;
      const enter = Math.min(a, b);
      if (enter > t0) {
        t0 = enter;
        ax = axis;
        s = d > 0 ? -1 : 1;
      }
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1 && t0 > 0 ? { t: t0, ax, s } : null;
  }
  function wallHit(x, z, dx, dz, reach) {
    let best = null;
    const seen = new Set();
    const ex = x + dx * reach;
    const ez = z + dz * reach;
    for (let ix = Math.floor(Math.min(x, ex) / WALL_CELL); ix <= Math.floor(Math.max(x, ex) / WALL_CELL); ix++) {
      for (let iz = Math.floor(Math.min(z, ez) / WALL_CELL); iz <= Math.floor(Math.max(z, ez) / WALL_CELL); iz++) {
        for (const c of wallGrid.get(ix * 100000 + iz) || []) {
          if (seen.has(c)) continue;
          seen.add(c);
          let h;
          let nx;
          let nz;
          if (c.obb) {
            // world -> the box's own frame: its x axis runs along (cs, -sn), its z axis along (sn, cs)
            const { cx, cz, hx, hz, cs, sn } = c.obb;
            const ox = x - cx;
            const oz = z - cz;
            h = slab(ox * cs - oz * sn, ox * sn + oz * cs, dx * cs - dz * sn, dx * sn + dz * cs, hx, hz);
            if (!h) continue;
            nx = h.ax === 0 ? h.s * cs : h.s * sn;
            nz = h.ax === 0 ? -h.s * sn : h.s * cs;
          } else {
            const cx = (c.minX + c.maxX) / 2;
            const cz = (c.minZ + c.maxZ) / 2;
            h = slab(x - cx, z - cz, dx, dz, (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2);
            if (!h) continue;
            nx = h.ax === 0 ? h.s : 0;
            nz = h.ax === 0 ? 0 : h.s;
          }
          if (h.t <= reach && (!best || h.t < best.t)) best = { t: h.t, nx, nz };
        }
      }
    }
    return best;
  }
  // The Old Town as buildings.js draws it (OLD_TOWN_BOX: Stare Miasto east of al. Marcinkowskiego, with Garbary and
  // Chwaliszewo), and Ostrów Tumski / Śródka within 650 m of the Katedra
  const OLD_TOWN_BOX = { x0: -330, x1: 900, z0: -900, z1: 600 };
  const KATEDRA = LANDMARK_SITES && LANDMARK_SITES.Katedra;
  const inOldTown = (b, x, z) =>
    (b.district === 'Stare Miasto' && x > OLD_TOWN_BOX.x0 && x < OLD_TOWN_BOX.x1 && z > OLD_TOWN_BOX.z0 && z < OLD_TOWN_BOX.z1) ||
    (!!KATEDRA && Math.hypot(x - KATEDRA.x, z - KATEDRA.z) < 650);
  const plates = { small: { matrices: [], cells: [], labels: [], keys: [] }, large: { matrices: [], cells: [], labels: [], keys: [] } };
  const placedPlates = [];
  if (wallGrid.size) {
    for (const { t, a, side } of plateSites) {
      const rx = a.uz * side;
      const rz = -a.ux * side;
      const x = a.x + a.ux * t + rx * (a.w / 2 + 0.3);
      const z = a.z + a.uz * t + rz * (a.w / 2 + 0.3);
      const b = blockAt(x + rx * 0.6, z + rz * 0.6);
      if (!b) continue;
      const hit = wallHit(x, z, rx, rz, 14);
      // only a wall facing back to the street, not a party wall seen edge-on
      if (!hit || hit.nx * -rx + hit.nz * -rz < 0.7) continue;
      const wx = x + rx * hit.t + hit.nx * 0.03;
      const wz = z + rz * hit.t + hit.nz * 0.03;
      if (placedPlates.some((p) => p.name === a.name && Math.hypot(p.x - wx, p.z - wz) < 25)) continue;
      placedPlates.push({ x: wx, z: wz, name: a.name });
      const set = plates[a.w < 10 || inOldTown(b, wx, wz) ? 'small' : 'large'];
      const label = plateLabel(a.name, b.district);
      const key = `${label.kind}|${label.name}|${label.district}`;
      let cell = set.keys.indexOf(key);
      if (cell < 0) {
        cell = set.keys.push(key) - 1;
        set.labels.push(label);
      }
      set.cells.push(cell % 8, Math.floor(cell / 8));
      set.matrices.push(setFacing(wx, 3.3, wz, hit.nx, hit.nz));
    }
  }
  const plateCount = plates.small.matrices.length + plates.large.matrices.length;

  // =========================================================================
  // 2. STREETLIGHTS ALONG EVERY CURB, BY STREET CLASS
  //    Walked along the true curb edges of every city block (BLOCKS poly), whatever their bearing, and verified with
  //    blockAt(x, z) so no pole ever stands in a roadway. Each edge takes the class of the road it fronts
  //    (nearestRoads): main streets (>= 12.5 m curb to curb, three lanes or more, or a trunk road) get 10 m LED bent
  //    masts every ~34 m, other streets 7 m ones every ~30 m, except in the Old Town and on Ostrów Tumski, where they
  //    get the historic gas lanterns Poznań still lights, every ~22 m. Poles stand ~1 m inside the curb, their
  //    footprints clear of the lanes (LANE_CLEAR).
  // =========================================================================
  const streetClass = (b, mx, mz, outX, outZ) => {
    const near = nearestRoads(mx + outX * 3, mz + outZ * 3, 18);
    const r = near.length ? near[0].road : null;
    if (r && (r.w >= 12.5 || r.lanes >= 3 || r.highway)) return 'main';
    return inOldTown(b, mx, mz) ? 'old' : 'side';
  };

  // Curb edges >= 24 m long that front an open roadway: { b, p0, dx, dz, len, inx, inz, outX, outZ, cls }
  const curbEdges = [];
  for (const b of BLOCKS) {
    if (!b || !b.poly || b.poly.length < 3 || b.median || b.park > 0.6) continue;
    const poly = b.poly;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 24) continue;
      const mx = (p0.x + p1.x) * 0.5;
      const mz = (p0.z + p1.z) * 0.5;
      // Inward normal (into the sidewalk block) and outward normal (into the roadway)
      let inx = -dz / len;
      let inz = dx / len;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) {
        inx = -inx;
        inz = -inz;
      }
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) continue;
      // Confirm this curb edge fronts an open roadway
      if (blockAt(mx - inx * 2.5, mz - inz * 2.5)) continue;
      curbEdges.push({ b, p0, dx, dz, len, inx, inz, outX: -inx, outZ: -inz, cls: streetClass(b, mx, mz, -inx, -inz) });
    }
  }

  const distPointToSeg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  const blockCurbDist = (px, pz, b) => {
    let best = Infinity;
    for (let i = 0; i < b.poly.length; i++) {
      const p1 = b.poly[i], p2 = b.poly[(i + 1) % b.poly.length];
      const d = distPointToSeg(px, pz, p1.x, p1.z, p2.x, p2.z);
      if (d < best) best = d;
    }
    if (b.tramCut) {
      for (const [ax, az, bx, bz] of b.tramCut.segs) {
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const half = b.tramCut.half;
        const ux = ((bx - ax) / len) * half, uz = ((bz - az) / len) * half;
        const quad = [
          { x: ax - ux + uz, z: az - uz - ux },
          { x: bx + ux + uz, z: bz + uz - ux },
          { x: bx + ux - uz, z: bz + uz + ux },
          { x: ax - ux - uz, z: az - uz + ux }
        ];
        for (let i = 0; i < 4; i++) {
          const q1 = quad[i], q2 = quad[(i + 1) % 4];
          const d = distPointToSeg(px, pz, q1.x, q1.z, q2.x, q2.z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
  // Design choice: minimum clearance from curb face to pole surface: >= 0.50 m (reflecting Polish urban road practice)
  const CURB_CLEARANCE = 0.50;

  const LAMP_CLASS = { main: { scale: 1, sp: 34 }, side: { scale: 0.7, sp: 30 } };
  const GAS_SP = 22;
  const mastMatrices = [];
  const ledHeadMatrices = [];
  const gasPostMatrices = [];
  const lampCount = { main: 0, side: 0, old: 0 };
  for (const { b, p0, dx, dz, len, inx, inz, outX, outZ, cls } of curbEdges) {
    if (cls === 'old') {
      const poleRadius = 0.20;
      const reqDist = poleRadius + CURB_CLEARANCE;
      const m = Math.max(1, Math.floor(len / GAS_SP));
      for (let j = 0; j < m; j++) {
        const nomF = (j + 0.5) / m;
        const checkCandidate = (f, inDist) => {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * inDist;
          const pz = cz + inz * inDist;
          if (!isOnSidewalk(px, pz, 0.5) || blockAt(cx + outX * 2.2, cz + outZ * 2.2) || !isClearOfPoles(px, pz, 5.2) ||
            !clearOfRoads(px, pz, 0.25) || !clearOfCrosswalks(px, pz, 0.2) || !clearOfRails(px, pz, 0.29)) return null;
          return { px, pz, cx, cz, f, inDist };
        };
        const nom = checkCandidate(nomF, 0.9);
        if (!nom) continue;
        let placed = nom;
        if (blockCurbDist(nom.px, nom.pz, b) < reqDist) {
          placed = null;
          for (let s = 0.5; s <= 8.0; s += 0.5) {
            for (const dir of [1, -1]) {
              const f = nomF + (dir * s) / len;
              if (f < 0.05 || f > 0.95) continue;
              const cand = checkCandidate(f, 0.9);
              if (cand && blockCurbDist(cand.px, cand.pz, b) >= reqDist) { placed = cand; break; }
            }
            if (placed) break;
          }
          if (!placed) {
            for (const delta of [0.05, -0.05, 0.10, -0.10, 0.15, -0.15, 0.20, -0.20]) {
              const cand = checkCandidate(nomF, 0.9 + delta);
              if (cand && blockCurbDist(cand.px, cand.pz, b) >= reqDist) { placed = cand; break; }
            }
          }
        }
        if (!placed) continue;
        const { px, pz } = placed;
        addPole({ x: px, z: pz });
        addFootprint(px, pz, 0.4, 0.4, 'gas');
        addCollider(px, pz, 0.18, 0.18, 4.36);
        dummy.position.set(px, 0.18, pz);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        gasPostMatrices.push(dummy.matrix.clone());
        streetPointSites.push({ x: px, y: 3.86, z: pz, color: 0xffd9a0, intensity: 27, dist: 13.5 });
        lampCount.old++;
      }
      continue;
    }
    const { scale, sp } = LAMP_CLASS[cls];
    const armYaw = Math.atan2(-outZ, outX);
    const poleRadius = 0.14 * scale;
    const reqDist = poleRadius + CURB_CLEARANCE;
    const n = Math.max(1, Math.floor(len / sp));
    for (let i = 0; i < n; i++) {
      const nomF = (i + 0.5) / n;
      const checkCandidate = (f, inDist) => {
        const cx = p0.x + dx * f;
        const cz = p0.z + dz * f;
        const lx = cx + inx * inDist;
        const lz = cz + inz * inDist;
        const headX = lx + outX * LED_REACH * scale;
        const headZ = lz + outZ * LED_REACH * scale;
        if (
          !isOnSidewalk(lx, lz, 0.55) ||
          !clearOfRoads(lx, lz, 0.3) ||
          !clearOfCrosswalks(lx, lz, 0.225) ||
          blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
          blockAt(headX, headZ) ||
          !isClearOfPoles(lx, lz, 6.5) ||
          !clearOfRails(lx, lz, 0.32) ||
          Math.hypot(lx - 3191.5, lz - 1609.5) < 3 ||
          Math.hypot(lx - 2522.4, lz - 1006.9) < 3 ||
          Math.hypot(lx - 2115.2, lz - 1908.0) < 3
        ) {
          return null;
        }
        return { lx, lz, headX, headZ, cx, cz, f, inDist };
      };

      const nom = checkCandidate(nomF, 1.08);
      if (!nom) continue;

      let placed = nom;
      if (blockCurbDist(nom.lx, nom.lz, b) < reqDist) {
        placed = null;
        // 1. Prefer moving pole further onto the sidewalk (or centering on narrow island)
        for (const delta of [0.05, 0.10, 0.15, 0.20, 0.25, -0.05, -0.10, -0.15, -0.20]) {
          const cand = checkCandidate(nomF, 1.08 + delta);
          if (cand && blockCurbDist(cand.lx, cand.lz, b) >= reqDist) {
            placed = cand; break;
          }
        }
        // 2. Try sliding along the curb edge
        if (!placed) {
          for (let s = 0.5; s <= 12.0; s += 0.5) {
            for (const dir of [1, -1]) {
              const f = nomF + (dir * s) / len;
              if (f < 0.05 || f > 0.95) continue;
              const cand = checkCandidate(f, 1.08);
              if (cand && blockCurbDist(cand.lx, cand.lz, b) >= reqDist) {
                placed = cand; break;
              }
            }
            if (placed) break;
          }
        }
        // 3. Try combining normal offset and sliding
        if (!placed) {
          for (let s = 0.5; s <= 8.0; s += 0.5) {
            for (const dir of [1, -1]) {
              const f = nomF + (dir * s) / len;
              if (f < 0.05 || f > 0.95) continue;
              for (const delta of [0.10, 0.20, -0.10, 0.30, -0.20]) {
                const cand = checkCandidate(f, 1.08 + delta);
                if (cand && blockCurbDist(cand.lx, cand.lz, b) >= reqDist) {
                  placed = cand; break;
                }
              }
              if (placed) break;
            }
            if (placed) break;
          }
        }
      }
      if (!placed) continue;
      const { lx, lz, headX, headZ } = placed;
      addPole({ x: lx, z: lz });
      addFootprint(lx, lz, 0.45, 0.45, 'led');
      addCollider(lx, lz, 0.14, 0.14, 0.1 + 8.6 * scale);
      dummy.position.set(lx, 0.1, lz);
      dummy.rotation.set(0, armYaw, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mastMatrices.push(dummy.matrix.clone());
      ledHeadMatrices.push(dummy.matrix.clone());
      dummy.scale.set(1, 1, 1);
      ledLampSites.push({
        x: headX,
        y: 0.1 + 9.9 * scale,
        z: headZ,
        tx: lx + outX * 3.4,
        tz: lz + outZ * 3.4
      });
      lampCount[cls]++;
    }
  }

  function addMatrixArrayInstanced(geo, mat, matrices, castShadow = true, attrs = null) {
    if (matrices.length === 0) return null;
    let g = geo;
    if (attrs) {
      g = geo.clone();
      for (const [key, { size, data }] of Object.entries(attrs)) {
        g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
      }
    }
    const inst = new THREE.InstancedMesh(g, mat, matrices.length);
    if (castShadow && !mat.isMeshBasicNodeMaterial && mat.type !== 'MeshBasicNodeMaterial' && !mat.transparent) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return inst;
  }

  const signalAttrs = (data) => ({ signalIndex: { size: 1, data } });
  addMatrixArrayInstanced(unitCyl, signalPoleMat, signalPoleMatrices);
  addMatrixArrayInstanced(s1HousingGeo, signalHousingMat, s1Matrices);
  addMatrixArrayInstanced(backplateGeo, signalHousingMat, backplateMatrices);
  addMatrixArrayInstanced(backplateBorderGeo, backplateBorderMat, backplateMatrices);
  addMatrixArrayInstanced(s1LensGeo, aveSignalLensMat, s1AveMatrices, false, signalAttrs(s1AveIndices));
  addMatrixArrayInstanced(s1LensGeo, streetSignalLensMat, s1StreetMatrices, false, signalAttrs(s1StreetIndices));
  addMatrixArrayInstanced(pedHousingGeo, signalHousingMat, pedHeadMatrices);
  addMatrixArrayInstanced(pedPanelGeo, aveWalkMat, pedAveMatrices, false, signalAttrs(pedAveIndices));
  addMatrixArrayInstanced(pedPanelGeo, streetWalkMat, pedStreetMatrices, false, signalAttrs(pedStreetIndices));
  addMatrixArrayInstanced(bentMastGeo, poleMetalMat, mastMatrices);
  addMatrixArrayInstanced(ledHousingGeo, poleMetalMat, ledHeadMatrices);
  addMatrixArrayInstanced(ledLensGeo, lampBulbGlow, ledHeadMatrices, false);
  addMatrixArrayInstanced(gasPostGeo, castIronMat, gasPostMatrices);
  addMatrixArrayInstanced(gasGlassGeo, gasGlassGlow, gasPostMatrices, false);
  for (const [size, set] of Object.entries(plates)) {
    if (!set.matrices.length) continue;
    const { w, h, cell: px } = PLATE_SIZES[size];
    const atlas = createPlateAtlas(set.labels, px);
    const plateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
    const cell = attribute('plateCell', 'vec2');
    // canvas row 0 is the texture's top (flipY)
    plateMat.colorNode = texture(atlas.tex, uv().add(vec2(cell.x, float(atlas.rows - 1).sub(cell.y))).div(vec2(atlas.cols, atlas.rows)));
    addMatrixArrayInstanced(new THREE.PlaneGeometry(w, h).translate(0, 0, 0.013), plateMat, set.matrices, false,
      { plateCell: { size: 2, data: set.cells } });
    addMatrixArrayInstanced(new THREE.BoxGeometry(w, h, 0.024), plateBackMat, set.matrices, false);
  }

  // =========================================================================
  // 3. CURBSIDE FURNITURE
  //    Tall red hydrants near the end of about every other curb edge, Poczta Polska post boxes now and then, parking
  //    machines on the side streets of the paid parking zone (Stare Miasto, Jeżyce, Łazarz, Wilda) and rows of
  //    bollards keeping cars off the sidewalks of the Old Town and side streets of the centre, 7-12 m from each corner
  //    (clear of the crosswalk landings). All stand within ~1 m of the curb, inside the walking lines
  //    (pedestrian-routes.js: 1.7 and 2.8 m in), and each is an obstacle footprint.
  // =========================================================================
  const curbSpot = (e, u, inset) => ({ x: e.p0.x + e.dx * u + e.inx * inset, z: e.p0.z + e.dz * u + e.inz * inset });
  const yawIn = (e) => Math.atan2(e.inx, e.inz);
  const hydrantMatrices = [];
  const postBoxMatrices = [];
  const parkingMatrices = [];
  const bollardMatrices = [];
  const PARKING_ZONE = new Set(['Stare Miasto', 'Jeżyce', 'Łazarz', 'Wilda']);
  const FURNITURE_TOP = { hydrant: [0.14, 1.46], postbox: [0.2, 1.56], parking: [0.2, 1.76], bollard: [0.07, 1.13] };
  const place = (list, p, yaw, w, kind, clear) => {
    if (!isClearOfPoles(p.x, p.z, clear) || !clearOfRoads(p.x, p.z, w / 2 + 0.05) || !clearOfCrosswalks(p.x, p.z, w / 2) ||
      !clearOfRails(p.x, p.z, w * 0.71) ||
      // Keep curbside furniture clear of chord cut where a dual-carriageway lane sweeps close to curb (Park Rataje border)
      Math.hypot(p.x - 2027.8, p.z - 1970.1) < 3) return false;
    addPole(p);
    addFootprint(p.x, p.z, w, w, kind);
    addCollider(p.x, p.z, FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][0], FURNITURE_TOP[kind][1]);
    dummy.position.set(p.x, 0.2, p.z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
    return true;
  };
  for (const e of curbEdges) {
    const { p0, len, b, cls } = e;
    if (len >= 30 && hashPos(p0.x, 5.3, p0.z) >= 0.45) {
      const p = curbSpot(e, 0.14, 0.8);
      if (isOnSidewalk(p.x, p.z, 0.45)) place(hydrantMatrices, p, yawIn(e), 0.35, 'hydrant', 1.5);
    }
    if (len >= 30 && hashPos(p0.x, 7.7, p0.z) < 0.08) {
      const p = curbSpot(e, 0.62, 0.8);
      if (isOnSidewalk(p.x, p.z, 0.45)) place(postBoxMatrices, p, yawIn(e), 0.4, 'postbox', 1.5);
    }
    if (cls !== 'main' && len >= 40 && PARKING_ZONE.has(b.district) && hashPos(p0.z, 2.1, p0.x) < 0.45) {
      const p = curbSpot(e, 0.33, 0.7);
      if (isOnSidewalk(p.x, p.z, 0.45)) place(parkingMatrices, p, yawIn(e), 0.4, 'parking', 1.5);
    }
    if ((cls === 'old' || (cls === 'side' && b.district === 'Stare Miasto')) && len >= 30 && hashPos(p0.x, 9.4, p0.z) < 0.6) {
      for (const fromEnd of [7, 8.25, 9.5, 10.75, 12]) {
        for (const u of [fromEnd / len, 1 - fromEnd / len]) {
          const p = curbSpot(e, u, 0.35);
          if (isOnSidewalk(p.x, p.z, 0.2)) place(bollardMatrices, p, 0, 0.18, 'bollard', 0.9);
        }
      }
    }
  }
  // Polish above-ground hydrant: a flanged foot, a tall red barrel with a white reflective band, two outlets and a
  // domed cap with the operating nut
  const hydrantGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10).translate(0, 0.03, 0),
    new THREE.CylinderGeometry(0.1, 0.1, 0.92, 10).translate(0, 0.52, 0),
    new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10).translate(0, 0.98, 0),
    new THREE.SphereGeometry(0.13, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.06, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6).translate(0, 1.22, 0),
    new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8).rotateZ(Math.PI / 2).translate(0, 0.78, 0)
  ].map((g) => g.toNonIndexed()));
  const hydrantBandGeo = new THREE.CylinderGeometry(0.103, 0.103, 0.08, 10, 1, true).translate(0, 0.9, 0);
  const hydrantMat = new THREE.MeshStandardNodeMaterial({ color: 0xc21a1e, roughness: 0.45, metalness: 0.3 });
  const reflectiveWhiteMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.3 });
  addMatrixArrayInstanced(hydrantGeo, hydrantMat, hydrantMatrices);
  addMatrixArrayInstanced(hydrantBandGeo, reflectiveWhiteMat, hydrantMatrices, false);
  // Poczta Polska post box: a red box with a rounded top on a dark post, its slot and a yellow band on the front
  const postBoxGeo = mergeGeometries([
    new THREE.BoxGeometry(0.4, 0.5, 0.3).translate(0, 1.05, 0),
    new THREE.CylinderGeometry(0.15, 0.15, 0.4, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.4, 1).translate(0, 1.3, 0)
  ].map((g) => g.toNonIndexed()));
  const postBoxPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.045, 0.045, 0.82, 8).translate(0, 0.41, 0),
    new THREE.BoxGeometry(0.28, 0.025, 0.02).translate(0, 1.18, 0.152)
  ].map((g) => g.toNonIndexed()));
  const postBoxBandGeo = new THREE.PlaneGeometry(0.4, 0.07).translate(0, 0.95, 0.151);
  const postBoxMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8161d, roughness: 0.42, metalness: 0.35 });
  const yellowMat = new THREE.MeshStandardNodeMaterial({ color: 0xf5c400, roughness: 0.4 });
  addMatrixArrayInstanced(postBoxGeo, postBoxMat, postBoxMatrices);
  addMatrixArrayInstanced(postBoxPostGeo, castIronMat, postBoxMatrices);
  addMatrixArrayInstanced(postBoxBandGeo, yellowMat, postBoxMatrices, false);
  // Parking machine: a grey cabinet facing the sidewalk with a sloped head, a screen and a blue "P" panel
  const parkingGeo = mergeGeometries([
    new THREE.BoxGeometry(0.36, 1.45, 0.26).translate(0, 0.725, 0),
    new THREE.BoxGeometry(0.4, 0.12, 0.32).translate(0, 1.5, 0)
  ].map((g) => g.toNonIndexed()));
  const parkingPanelGeo = new THREE.PlaneGeometry(0.2, 0.2).translate(0, 1.32, 0.131);
  const parkingScreenGeo = new THREE.PlaneGeometry(0.2, 0.13).translate(0, 1.08, 0.131);
  const parkingMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e959c, roughness: 0.4, metalness: 0.6 });
  const parkingPanelMat = new THREE.MeshStandardNodeMaterial({ color: 0x1f4fa8, roughness: 0.4 });
  const screenMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c2a2e, roughness: 0.15, metalness: 0.2 });
  addMatrixArrayInstanced(parkingGeo, parkingMat, parkingMatrices);
  addMatrixArrayInstanced(parkingPanelGeo, parkingPanelMat, parkingMatrices, false);
  addMatrixArrayInstanced(parkingScreenGeo, screenMat, parkingMatrices, false);
  // Bollard: a 0.9 m cast-iron post with a domed top and a white reflective ring
  const bollardGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.06, 0.07, 0.86, 8).translate(0, 0.43, 0),
    new THREE.SphereGeometry(0.065, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.86, 0)
  ].map((g) => g.toNonIndexed()));
  const bollardRingGeo = new THREE.CylinderGeometry(0.063, 0.063, 0.06, 8, 1, true).translate(0, 0.74, 0);
  addMatrixArrayInstanced(bollardGeo, castIronMat, bollardMatrices);
  addMatrixArrayInstanced(bollardRingGeo, reflectiveWhiteMat, bollardMatrices, false);

  // =========================================================================
  // 3B. KIOSKS AND ADVERTISING COLUMNS ON WIDE SIDEWALKS
  //     Only where the sidewalk is wide: 3.8 m or more from the curb (beyond both walking lines) and clear of the
  //     block's lot rects (the property line; frontage frames turned into place), spaced well apart. Press kiosks,
  //     flower stands and słupy ogłoszeniowe (posters wrapped round a green cast-iron column).
  // =========================================================================
  const lotCache = new Map();
  const lotsOf = (b) => {
    if (!lotCache.has(b)) {
      lotCache.set(b, (b.frames || [[0, 0, 0, b.rects || []]]).flatMap(([th, px, pz, rects]) =>
        rects.map((r) => ({ cs: Math.cos(th), sn: Math.sin(th), px, pz, r }))));
    }
    return lotCache.get(b);
  };
  const inLot = (b, x, z, m) => lotsOf(b).some(({ cs, sn, px, pz, r }) => {
    const dx = x - px;
    const dz = z - pz;
    const lx = px + dx * cs - dz * sn;
    const lz = pz + dx * sn + dz * cs;
    return lx > r[0] - m && lx < r[1] + m && lz > r[2] - m && lz < r[3] + m;
  });
  const kioskMatrices = [];
  const flowerMatrices = [];
  const columnMatrices = [];
  const bigSites = [];
  const farFrom = (x, z, kind, d) => !bigSites.some((s) => (s.kind === kind ? Math.hypot(s.x - x, s.z - z) < d : Math.hypot(s.x - x, s.z - z) < 15));
  for (const e of curbEdges) {
    const { b, p0, dx, dz, len, inx, inz, outX, outZ } = e;
    if (len < 30 || hashPos(p0.x, 3.3, p0.z) > 0.5) continue;
    const r = hashPos(p0.z, 1.7, p0.x);
    const kind = r < 0.45 ? 'column' : r < 0.8 ? 'kiosk' : 'flower';
    const halfW = kind === 'column' ? 0.65 : kind === 'kiosk' ? 1.1 : 1.0;
    const halfD = kind === 'column' ? 0.65 : kind === 'kiosk' ? 0.75 : 0.95;
    const depth = 3.8 + halfD;
    const ux = dx / len;
    const uz = dz / len;
    for (let s = 10; s <= len - 10; s += 8) {
      const x = p0.x + ux * s + inx * depth;
      const z = p0.z + uz * s + inz * depth;
      if (!farFrom(x, z, kind, kind === 'column' ? 320 : 420)) break;
      let ok = isClearOfPoles(x, z, halfW + 1.5) && clearOfRails(x, z, halfW + halfD);
      for (const [a, c] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (!ok) break;
        const qx = x + ux * halfW * a + inx * (halfD + 0.3) * c;
        const qz = z + uz * halfW * a + inz * (halfD + 0.3) * c;
        ok = blockAt(qx, qz) === b && !inLot(b, qx, qz, 0.3) && !inPlaza(qx, qz, 0.5);
      }
      if (!ok) continue;
      bigSites.push({ x, z, kind });
      addPole({ x, z });
      const w = Math.abs(ux) * halfW * 2 + Math.abs(inx) * halfD * 2;
      const d = Math.abs(uz) * halfW * 2 + Math.abs(inz) * halfD * 2;
      addFootprint(x, z, w, d, kind);
      if (kind === 'column') addCollider(x, z, 0.62, 0.62, 3.4);
      else {
        // kiosks and flower stands face the street: an oriented box (its x axis along the curb, z out to the street)
        const hx = kind === 'kiosk' ? 1.1 : 0.9;
        const hz = kind === 'kiosk' ? 0.75 : 0.9;
        const cx = x + outX * (kind === 'kiosk' ? 0 : -0.05);
        const cz = z + outZ * (kind === 'kiosk' ? 0 : -0.05);
        const ex = Math.abs(outZ) * hx + Math.abs(outX) * hz;
        const ez = Math.abs(outX) * hx + Math.abs(outZ) * hz;
        colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: kind === 'kiosk' ? 2.72 : 2.4,
          obb: { cx, cz, hx, hz, cs: outZ, sn: outX } });
      }
      dummy.position.set(x, 0.2, z);
      dummy.rotation.set(0, Math.atan2(outX, outZ), 0); // fronts face the street
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      (kind === 'column' ? columnMatrices : kind === 'kiosk' ? kioskMatrices : flowerMatrices).push(dummy.matrix.clone());
      break;
    }
  }
  // Press kiosk: a cream cabinet with a glazed front and side, a red sign band and an overhanging flat roof
  const kioskGeo = mergeGeometries([
    new THREE.BoxGeometry(2.2, 2.25, 1.5).translate(0, 1.125, 0),
    new THREE.BoxGeometry(2.5, 0.14, 1.8).translate(0, 2.45, 0.05)
  ].map((g) => g.toNonIndexed()));
  const kioskBandGeo = new THREE.BoxGeometry(2.22, 0.26, 1.52).translate(0, 2.17, 0);
  const kioskGlassGeo = mergeGeometries([
    new THREE.PlaneGeometry(1.9, 0.95).translate(0, 1.45, 0.752),
    new THREE.PlaneGeometry(1.1, 0.95).rotateY(Math.PI / 2).translate(1.102, 1.45, 0)
  ]);
  const kioskMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8d0bc, roughness: 0.6, metalness: 0.15 });
  const kioskBandMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8262a, roughness: 0.45 });
  const kioskGlassMat = new THREE.MeshStandardNodeMaterial({ color: 0x223038, roughness: 0.12, metalness: 0.3 });
  addMatrixArrayInstanced(kioskGeo, kioskMat, kioskMatrices);
  addMatrixArrayInstanced(kioskBandGeo, kioskBandMat, kioskMatrices);
  addMatrixArrayInstanced(kioskGlassGeo, kioskGlassMat, kioskMatrices, false);
  // Flower stand: a green cabin, a sloping awning out front over tiered shelves of buckets in flower
  const flowerStandGeo = mergeGeometries([
    new THREE.BoxGeometry(1.8, 2.1, 1.0).translate(0, 1.05, -0.45),
    new THREE.BoxGeometry(2.0, 0.05, 1.0).rotateX(0.3).translate(0, 2.05, 0.45)
  ].map((g) => g.toNonIndexed()));
  const flowerShelfGeo = mergeGeometries([
    new THREE.BoxGeometry(1.7, 0.45, 0.45).translate(0, 0.45, 0.6),
    new THREE.BoxGeometry(1.7, 0.4, 0.35).translate(0, 0.85, 0.3)
  ].map((g) => g.toNonIndexed()));
  const flowerStandMat = new THREE.MeshStandardNodeMaterial({ color: 0x2f5a3a, roughness: 0.55, metalness: 0.2 });
  const flowerMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
  // ~11 cm cells of red, yellow and pink blooms
  flowerMat.colorNode = Fn(() => {
    const c = floor(positionWorld.mul(9));
    const h = fract(sin(c.x.mul(12.9898).add(c.y.mul(78.233)).add(c.z.mul(37.719))).mul(43758.5453));
    return mix(mix(color(0xc81e3a), color(0xf0c030), step(0.4, h)), color(0xe86aa2), step(0.72, h));
  })();
  addMatrixArrayInstanced(flowerStandGeo, flowerStandMat, flowerMatrices);
  addMatrixArrayInstanced(flowerShelfGeo, flowerMat, flowerMatrices);
  // Advertising column: a green cast-iron plinth, a poster drum 1.1 m across and 2.4 m tall, a cornice and a dome
  const columnFrameGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.62, 0.66, 0.32, 16).translate(0, 0.16, 0),
    new THREE.CylinderGeometry(0.66, 0.6, 0.14, 16).translate(0, 2.79, 0),
    new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 2.86, 0),
    new THREE.SphereGeometry(0.07, 8, 6).translate(0, 3.17, 0)
  ].map((g) => g.toNonIndexed()));
  const columnDrumGeo = new THREE.CylinderGeometry(0.55, 0.55, 2.4, 20, 1, true).translate(0, 1.52, 0);
  const columnFrameMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a4636, roughness: 0.55, metalness: 0.4 });
  const posterMat = new THREE.MeshStandardNodeMaterial({ map: createPosterTexture(), roughness: 0.75 });
  addMatrixArrayInstanced(columnFrameGeo, columnFrameMat, columnMatrices);
  addMatrixArrayInstanced(columnDrumGeo, posterMat, columnMatrices);

  console.info(`[streetDetails] ${s1Matrices.length} signal heads and ${pedHeadMatrices.length} pedestrian heads on ` +
    `${signalPoleMatrices.length} poles at ${builtJunctions.size} junctions, ${plateCount} name plates; lamps ` +
    `${lampCount.main} main, ${lampCount.side} side, ${lampCount.old} gas; ${hydrantMatrices.length} hydrants, ` +
    `${postBoxMatrices.length} post boxes, ${parkingMatrices.length} parking machines, ${bollardMatrices.length} bollards, ` +
    `${kioskMatrices.length} kiosks, ${flowerMatrices.length} flower stands, ${columnMatrices.length} advertising columns`);


  // =========================================================================
  // 4. TREES: PARKS, SQUARES & PLAZAS, AND STREET TREES ALONG THE CURBS
  //    (one unified trunk + crown instanced mesh per species & band, js/trees.js)
  // =========================================================================
  const { isClearOfWalls } = createTreeWallChecker(buildingColliders, SPECIES_CROWN_R);

  const treePositions = []; // { x, y, z, scale, species (0 lime, 1 Norway maple, 2 horse chestnut; trees.js can reassign 3 black locust) }
  const mixSpecies = (r, lime, maple) => (r < lime ? 0 : (r < lime + maple ? 1 : 2));

  // A. The parks, squares & plazas (sites laid out by city-grid.js, plus buildings.js's leftover slabs)
  for (const s of parkTreeSites || []) {
    if (isClearOfWalls(s.x, s.z, s.scale, s.species, 1.0, s.y || 0.41, s.tier || 1)) {
      treePositions.push(s);
    } else if (s.collider && propColliders) {
      const idx = propColliders.indexOf(s.collider);
      if (idx !== -1) propColliders.splice(idx, 1);
    }
  }

  // B. Street trees on the raised sidewalks of every real block, along each curb edge: small trees close to the curb
  //    on the narrow streets (a block across within ~14 m), limes, maples & chestnuts on the wider ones (trees.js also selects black locust), with random
  //    missing trees and the odd unplanted edge; sparse in Stare Miasto's narrow lanes. Never in plazas or parks.
  const sidewalkTreePositions = [];
  const SIDEWALK_Y = 0.22;
  const treeBlockAt = blockAt;
  const onSidewalk = (x, z) => {
    const b = treeBlockAt(x, z);
    return !!b && !(b.park > 0.6) && !b.median;
  };
  // Street trees turn in 90° steps with the crown squeezed across the sidewalk, away from the facades
  function addStreetTree(x, z, scale, species, acrossX, extra = {}) {
    if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2) || !clearOfRails(x, z, 0.4 * scale)) return;
    const q = Math.floor(hashPos(x, 8.8, z) * 3.999);
    const t = { x, y: SIDEWALK_Y, z, scale, species, yaw: q * Math.PI * 0.5, tier: 1, ...extra };
    if (acrossX === (q % 2 === 0)) t.sx = extra.squeeze || 0.82;
    else t.sz = extra.squeeze || 0.82;
    treePositions.push(t);
    sidewalkTreePositions.push(t);
    // Street trees block the player like the park & plaza trunks in city-grid.js: a box about the flared root, tall
    // enough to stop a jump over the curb. They stay off the traffic footprints so the sidewalk links and lanes are
    // unchanged; only the player's collider list gets them.
    const c = addCollider(x, z, 0.28 * scale, 0.28 * scale, SIDEWALK_Y + 3.0);
    c.isTrunk = true;
  }
  const treePlacement = { moved: 0, dropped: 0 };
  // Build-time only: trees add no traffic footprints, so this furnished network is the one traffic will use.
  // The guide envelope alone misses lanes shifted over curb islands and squeezed short-link crossing bands.
  const treeNetwork = buildRoadNetwork(grid?.sidewalks || [], [
    ...(grid?.footprints || []), ...footprints,
    ...buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ]);
  const treeKeepouts = new Map();
  const TREE_LANE_CELL = 64;
  const fileTreeKeepout = (s, pad) => {
    for (let ix = Math.floor((Math.min(s.ax, s.bx) - pad) / TREE_LANE_CELL); ix <= Math.floor((Math.max(s.ax, s.bx) + pad) / TREE_LANE_CELL); ix++) {
      for (let iz = Math.floor((Math.min(s.az, s.bz) - pad) / TREE_LANE_CELL); iz <= Math.floor((Math.max(s.az, s.bz) + pad) / TREE_LANE_CELL); iz++) {
        const key = ix * 100000 + iz;
        if (!treeKeepouts.has(key)) treeKeepouts.set(key, []);
        treeKeepouts.get(key).push(s);
      }
    }
  };
  for (const e of treeNetwork.edges) {
    for (const lane of e.lanes) fileTreeKeepout({
      ax: e.x0 + e.rx * lane, az: e.z0 + e.rz * lane,
      bx: e.x0 + e.dx * e.span + e.rx * lane, bz: e.z0 + e.dz * e.span + e.rz * lane
    }, 1.5);
    // Enclose every possible zebra and landing before route pruning, including squeezed crossing setbacks.
    for (const [node, along] of [[e.from, -e.setbackFrom - CROSSWALK / 2],
      [e.to, e.len + e.setbackTo + CROSSWALK / 2]]) {
      if (node.shape) continue;
      const x = e.sx + e.dx * along, z = e.sz + e.dz * along;
      const half = e.half + CROSSWALK_REACH + 2.6;
      fileTreeKeepout({ ax: x - e.rx * half, az: z - e.rz * half,
        bx: x + e.rx * half, bz: z + e.rz * half, zebra: true }, CROSSWALK / 2 + 0.4);
    }
  }
  const clearStreetTree = (x, z, scale) => {
    const r = 0.28 * scale;
    const b = treeBlockAt(x, z);
    if (!b || b.median || b.underpass) return false;
    // Every trunk corner must stay on the centre's block: a different island can take priority at a corner even
    // inside this block's bounds (overlapping blocks), so the check runs for every candidate.
    for (const ox of [-r, r]) for (const oz of [-r, r]) {
      if (treeBlockAt(x + ox, z + oz) !== b) return false;
    }
    if (!clearOfCrosswalks(x, z, r * Math.SQRT2)) return false;
    for (const s of treeKeepouts.get(Math.floor(x / TREE_LANE_CELL) * 100000 + Math.floor(z / TREE_LANE_CELL)) || []) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz);
      const along = ((x - s.ax) * dx + (z - s.az) * dz) / len;
      const side = Math.abs((x - s.ax) * dz - (z - s.az) * dx) / len;
      const pad = r * (Math.abs(dx) + Math.abs(dz)) / len;
      if (s.zebra) {
        if (along > -pad && along < len + pad && side < CROSSWALK / 2 + pad) return false;
      } else if (Math.hypot(Math.max(0, -along, along - len), side) < Math.max(1.2, 0.9 + pad)) return false;
    }
    return true;
  };
  const streetTreeCandidates = [];
  const TREE_SP = 15;
  for (const edge of curbEdges) {
    const { b, p0, dx, dz, len, inx, inz, outX, outZ } = edge;
    if (hashPos(p0.x, 4.2, p0.z) < 0.22) continue;
    const thin = b.district === 'Stare Miasto' ? 0.6 : 0.32;
    const mx = p0.x + dx * 0.5;
    const mz = p0.z + dz * 0.5;
    const narrow = !!blockAt(mx + outX * 14, mz + outZ * 14);
    const inset = narrow ? 0.9 : 1.25;
    const acrossX = Math.abs(dz) > Math.abs(dx); // the edge runs along z: squeeze the crown across x
    const pitRot = Math.atan2(dx, dz); // pits run along the curb
    const n = Math.floor((len - 7) / TREE_SP) + 1;
    const t0 = (len - (n - 1) * TREE_SP) * 0.5;
    for (let i = 0; i < n; i++) {
      const u = (t0 + i * TREE_SP + (hashPos(i, p0.z, p0.x) - 0.5) * 1.6) / len;
      let x = p0.x + dx * u + inx * inset;
      let z = p0.z + dz * u + inz * inset;
      const r = hashPos(x, 6.1, z);
      if (r < thin) continue;
      const species = narrow ? 1 : mixSpecies(hashPos(z, 2.9, x), 0.4, 0.35);
      const scale = narrow ? 0.54 + r * 0.1 : 0.6 + r * 0.24;
      const tier = narrow ? 2 : 1;
      const squeeze = narrow ? 0.7 : 0.82;

      if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2) ||
          !clearOfRails(x, z, 0.4 * scale)) continue;

      if (!isClearOfWalls(x, z, scale, species, squeeze, SIDEWALK_Y, tier)) {
        let placed = false;
        for (const s of [-0.4, 0.4, -0.8, 0.8, -1.2, 1.2, -1.6, 1.6]) {
          const su = u + s / len;
          if (su < 0.02 || su > 0.98) continue;
          const sx = p0.x + dx * su + inx * inset;
          const sz = p0.z + dz * su + inz * inset;
          if (!onSidewalk(sx, sz) || inPlaza(sx, sz, 1.5) || !isClearOfPoles(sx, sz, 2.2) ||
              !clearOfRails(sx, sz, 0.4 * scale)) continue;
          if (!isClearOfWalls(sx, sz, scale, species, squeeze, SIDEWALK_Y, tier)) continue;
          x = sx;
          z = sz;
          placed = true;
          break;
        }
        if (!placed) continue;
      }

      streetTreeCandidates.push({ x, z, scale, species, acrossX, tier, pitRot, narrow, squeeze,
        p0, dx, dz, len, inx, inz, inset, u });
    }
  }
  const placedTreeCells = new Map();
  const treeCellKey = (x, z) => Math.floor(x / 4) * 100000 + Math.floor(z / 4);
  const reserveTree = (t) => {
    const key = treeCellKey(t.x, t.z);
    if (!placedTreeCells.has(key)) placedTreeCells.set(key, []);
    placedTreeCells.get(key).push(t);
  };
  const clearOfTrees = (x, z) => {
    const ix = Math.floor(x / 4), iz = Math.floor(z / 4);
    for (let i = ix - 1; i <= ix + 1; i++) for (let j = iz - 1; j <= iz + 1; j++) {
      for (const t of placedTreeCells.get(i * 100000 + j) || []) {
        if ((x - t.x) ** 2 + (z - t.z) ** 2 < 3.5 ** 2) return false;
      }
    }
    return true;
  };
  // Reserve unchanged trees first, including those later in the curb iteration. Existing close pairs stay intact;
  // a replacement must keep 3.5 m from every unchanged or already moved tree, even on a different curb edge.
  for (const t of streetTreeCandidates) {
    t.clear = clearStreetTree(t.x, t.z, t.scale);
    if (t.clear) reserveTree(t);
  }
  for (const t of streetTreeCandidates) {
    let { x, z } = t;
    const { scale, species, acrossX, tier, pitRot, narrow, squeeze, p0, dx, dz, len, inx, inz, inset, u } = t;
    if (!t.clear) {
      let placed = false;
      // Nearest first, stable negative-side tie break; every replacement checks both curb clearance and spacing.
      for (let step = 1; step <= 15 && !placed; step++) for (const sign of [-1, 1]) {
        const su = u + sign * step * 0.4 / len;
        if (su < 0.02 || su > 0.98) continue;
        const sx = p0.x + dx * su + inx * inset;
        const sz = p0.z + dz * su + inz * inset;
        if (!clearOfTrees(sx, sz) || !clearStreetTree(sx, sz, scale) || !onSidewalk(sx, sz) || inPlaza(sx, sz, 1.5) ||
            !isClearOfPoles(sx, sz, 2.2) || !clearOfRails(sx, sz, 0.4 * scale) ||
            !isClearOfWalls(sx, sz, scale, species, squeeze, SIDEWALK_Y, tier)) continue;
        x = sx;
        z = sz;
        placed = true;
        reserveTree({ x, z });
        break;
      }
      if (!placed) { treePlacement.dropped++; continue; }
      treePlacement.moved++;
    }
    addStreetTree(x, z, scale, species, acrossX, {
      tier, pitRot, grate: !narrow, pitS: narrow ? 0.7 : 1, squeeze
    });
  }
  console.info(`[streetDetails] ${treePositions.length} trees (${sidewalkTreePositions.length} street trees)`);

  const grateMat = createTreeGrateMaterial();
  const pitCurbMat = new THREE.MeshStandardNodeMaterial({ color: 0x484642, roughness: 0.88 });
  const pitSoilMat = new THREE.MeshStandardNodeMaterial({ color: 0x241c14, roughness: 0.96 });

  // Curbside tree pit surrounds & dark soil beds, with concentric cast-iron grates on the wider streets
  // (pits run along the curb: t.pitRot = PI/2 on cross streets)
  const pitCurbGeo = new THREE.BoxGeometry(1.7, 0.22, 2.6);
  const pitSoilGeo = new THREE.BoxGeometry(1.35, 0.23, 2.25);
  const pitGrateGeo = new THREE.RingGeometry(0.24, 0.82, 12, 1).rotateX(-Math.PI / 2);
  const gratedTrees = sidewalkTreePositions.filter((t) => t.grate !== false);

  const pitCurbInst = new THREE.InstancedMesh(pitCurbGeo, pitCurbMat, sidewalkTreePositions.length);
  const pitSoilInst = new THREE.InstancedMesh(pitSoilGeo, pitSoilMat, sidewalkTreePositions.length);
  const pitGrateInst = new THREE.InstancedMesh(pitGrateGeo, grateMat, Math.max(1, gratedTrees.length));
  pitCurbInst.receiveShadow = true;
  pitSoilInst.receiveShadow = true;
  pitGrateInst.receiveShadow = true;
  pitGrateInst.count = gratedTrees.length;

  sidewalkTreePositions.forEach((t, i) => {
    dummy.rotation.set(0, t.pitRot || 0, 0);
    dummy.scale.set(t.pitS || 1, 1, 1);
    dummy.position.set(t.x, 0.19, t.z);
    dummy.updateMatrix();
    pitCurbInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, 0.20, t.z);
    dummy.updateMatrix();
    pitSoilInst.setMatrixAt(i, dummy.matrix);
  });
  gratedTrees.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, 0.225, t.z);
    dummy.updateMatrix();
    pitGrateInst.setMatrixAt(i, dummy.matrix);
  });
  pitCurbInst.instanceMatrix.needsUpdate = true;
  pitSoilInst.instanceMatrix.needsUpdate = true;
  pitGrateInst.instanceMatrix.needsUpdate = true;
  for (const pit of [pitCurbInst, pitSoilInst, pitGrateInst]) pit.computeBoundingSphere();
  group.add(pitCurbInst, pitSoilInst, pitGrateInst);

  function hashPos(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // Procedural trees (js/trees.js): species skeletons with leaf-spray cards, one instanced mesh per species, variant &
  // level of detail, each tree's level following the camera
  const treeField = createTreeField(scene, treePositions);
  group.add(treeField.group);

  // =========================================================================
  // 5. CLUSTERED STREETLIGHTS & STREET FURNITURE LIGHT POOLS
  // =========================================================================
  for (const s of parkLampSites || []) {
    streetPointSites.push({ x: s.x, y: s.y, z: s.z, color: 0xffe4b4, intensity: 32, dist: 14.0 });
  }

  const STREETLIGHT_SPOT_POOL = 36;
  const STREET_POINT_POOL = 48;
  const STREETLIGHT_DIST = 115;
  const STREETLIGHT_DIST_SQ = STREETLIGHT_DIST * STREETLIGHT_DIST;
  const STREET_POINT_DIST = 110;
  const STREET_POINT_DIST_SQ = STREET_POINT_DIST * STREET_POINT_DIST;

  const streetLightsGroup = new THREE.Group();
  streetLightsGroup.name = 'StreetClusteredLights';
  scene.add(streetLightsGroup);

  const streetlightSpotPool = [];
  for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
    // LED luminaire: wide downward spread (0.96 rad half-angle) illuminating both road and sidewalk
    const spot = new THREE.SpotLight(0xffe8c2, 0, 25, 0.96, 0.82, 1.25);
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    streetLightsGroup.add(spot, spot.target);
    streetlightSpotPool.push(spot);
  }

  const streetPointPool = [];
  for (let i = 0; i < STREET_POINT_POOL; i++) {
    const pt = new THREE.PointLight(0xffe4b4, 0, 12, 1.35);
    pt.position.set(0, -1000, 0);
    streetLightsGroup.add(pt);
    streetPointPool.push(pt);
  }

  const activeLeds = [];
  const activePoints = [];

  function smoothFade(d, start, end) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function update(camera) {
    updateSignalTexture();
    if (!camera) return;
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    // Streetlights fade in smoothly as dusk approaches (matching lampBulbGlow smoothstep(0.4, 1.1, uInteriorGlow))
    const lampScale = Math.min(1.25, Math.max(0.0, (glow - 0.36) * 1.15));
    if (lampScale <= 0.001) {
      for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
        streetlightSpotPool[i].intensity = 0;
        streetlightSpotPool[i].position.set(0, -1000, 0);
      }
      for (let i = 0; i < STREET_POINT_POOL; i++) {
        streetPointPool[i].intensity = 0;
        streetPointPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const me = camera.matrixWorld.elements;
    const fwdX = -me[8];
    const fwdZ = -me[10];

    let ledCount = 0;
    for (let i = 0; i < ledLampSites.length; i++) {
      const s = ledLampSites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const d2 = dx * dx + dz * dz + cy * cy;
      if (d2 > STREETLIGHT_DIST_SQ) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STREETLIGHT_DIST) continue;
      s._effDist = effDist;
      activeLeds[ledCount++] = s;
    }
    activeLeds.length = ledCount;
    if (ledCount > 1) activeLeds.sort((a, b) => a._effDist - b._effDist);

    const ledCutoff = ledCount > STREETLIGHT_SPOT_POOL
      ? Math.min(STREETLIGHT_DIST, activeLeds[STREETLIGHT_SPOT_POOL]._effDist)
      : STREETLIGHT_DIST;
    const spotUsed = Math.min(ledCount, STREETLIGHT_SPOT_POOL);
    for (let i = 0; i < spotUsed; i++) {
      const s = activeLeds[i];
      const fade = smoothFade(s._effDist, ledCutoff * 0.62, ledCutoff);
      const spot = streetlightSpotPool[i];
      spot.position.set(s.x, s.y, s.z);
      spot.target.position.set(s.tx, 0.0, s.tz);
      spot.target.updateMatrixWorld();
      spot.intensity = 88.0 * lampScale * fade;
    }
    for (let i = spotUsed; i < STREETLIGHT_SPOT_POOL; i++) {
      streetlightSpotPool[i].intensity = 0;
      streetlightSpotPool[i].position.set(0, -1000, 0);
    }

    let ptCount = 0;
    for (let i = 0; i < streetPointSites.length; i++) {
      const s = streetPointSites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const d2 = dx * dx + dz * dz + cy * cy;
      if (d2 > STREET_POINT_DIST_SQ) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STREET_POINT_DIST) continue;
      s._effDist = effDist;
      activePoints[ptCount++] = s;
    }
    activePoints.length = ptCount;
    if (ptCount > 1) activePoints.sort((a, b) => a._effDist - b._effDist);

    const ptCutoff = ptCount > STREET_POINT_POOL
      ? Math.min(STREET_POINT_DIST, activePoints[STREET_POINT_POOL]._effDist)
      : STREET_POINT_DIST;
    const ptUsed = Math.min(ptCount, STREET_POINT_POOL);
    for (let i = 0; i < ptUsed; i++) {
      const s = activePoints[i];
      const fade = smoothFade(s._effDist, ptCutoff * 0.62, ptCutoff);
      const pt = streetPointPool[i];
      pt.color.setHex(s.color);
      pt.position.set(s.x, s.y, s.z);
      pt.distance = s.dist;
      pt.intensity = s.intensity * lampScale * fade;
    }
    for (let i = ptUsed; i < STREET_POINT_POOL; i++) {
      streetPointPool[i].intensity = 0;
      streetPointPool[i].position.set(0, -1000, 0);
    }
  }

  const staticHeadSites = vehicleHeadSites.slice();

  // Shared by the diagnostic audit and boot-time placement. Clearance is conservative: a pole's 0.3 m square
  // is expanded by the exact margins used by lane, curve and pedestrian checks when the network is rebuilt.
  function auditRuntimeSignalHeads(network, pedRoutes, place = false) {
    const heads = [], entries = [], cell = 16, headReach = 30;
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const index = () => new Map();
    const file = (map, item, minX, maxX, minZ, maxZ) => {
      for (let ix = Math.floor(minX / cell); ix <= Math.floor(maxX / cell); ix++) {
        for (let iz = Math.floor(minZ / cell); iz <= Math.floor(maxZ / cell); iz++) {
          const k = `${ix},${iz}`;
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(item);
        }
      }
    };
    const lookup = (map, x, z) => map.get(key(x, z)) || [];
    const curves = index(), lanes = index(), crossings = index(), buildings = index(), overhead = index();
    for (const n of network.nodes) for (const e of n.in) for (const move of e.moves) {
      for (let i = 0; i < move.out.length; i++) {
        const j = move.out[i];
        if (j < 0) continue;
        const curve = network.connector(e, i, move.to, j), point = {};
        for (let k = 1; k < 10; k++) {
          network.curvePoint(curve, curve.len * k / 10, point);
          const p = { x: point.x, z: point.z };
          file(curves, p, p.x - 0.95, p.x + 0.95, p.z - 0.95, p.z + 0.95);
        }
      }
    }
    // The original laneOpen tests 2.5 m samples on the whole untrimmed run, not just its visible edge.
    for (const e of network.edges) for (const lane of e.lanes) {
      const margin = 1.35;
      const x0 = e.x0 + e.rx * lane, z0 = e.z0 + e.rz * lane;
      const x1 = x0 + e.dx * e.span, z1 = z0 + e.dz * e.span;
      const segment = { ax: x0, az: z0, bx: x1, bz: z1, margin };
      file(lanes, segment, Math.min(x0, x1) - margin, Math.max(x0, x1) + margin,
        Math.min(z0, z1) - margin, Math.max(z0, z1) + margin);
    }
    const addWalk = (walks, track) => {
      const ax = track.ax, az = track.az, bx = ax + track.ux * track.len, bz = az + track.uz * track.len;
      // clear() tests an axis-aligned box around each one-metre step, so include that step as well as
      // its 0.4 m clearance and the pole footprint. A narrow diagonal corridor alone misses box corners.
      const margin = 1.55;
      const segment = { ax, az, bx, bz, margin };
      file(walks, segment, Math.min(ax, bx) - margin, Math.max(ax, bx) + margin,
        Math.min(az, bz) - margin, Math.max(az, bz) + margin);
    };
    for (const c of pedRoutes.crosswalks) {
      const margin = c.h + 2.75;
      file(crossings, c, Math.min(c.ax, c.bx) - margin, Math.max(c.ax, c.bx) + margin,
        Math.min(c.az, c.bz) - margin, Math.max(c.az, c.bz) + margin);
    }
    for (const c of buildingColliders) {
      if ((c.minY ?? 0) > SIGNAL_POLE_H + 0.1 || (c.maxY ?? Infinity) < 0.1) continue;
      file(buildings, c, c.minX - 0.15, c.maxX + 0.15, c.minZ - 0.15, c.maxZ + 0.15);
    }
    // Tall obstacles an arm at 5.55 m would hit: buildings, bridge decks and other colliders spanning the arm's
    // height. The ground index above stops at 4.3 m and misses the viaducts that cross several signal approaches.
    for (const c of buildingColliders) {
      if ((c.minY ?? 0) > OVERHEAD_ARM_Y + 0.6 || (c.maxY ?? Infinity) < OVERHEAD_ARM_Y - 0.6) continue;
      file(overhead, c, c.minX - 0.15, c.maxX + 0.15, c.minZ - 0.15, c.maxZ + 0.15);
    }
    // Segment intersects a square around the candidate (the rectangle query used by walkable/pathClear).
    const intersects = (s, x, z) => {
      let lo = 0, hi = 1;
      for (const [a, d, centre] of [[s.ax, s.bx - s.ax, x], [s.az, s.bz - s.az, z]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(a - centre) > s.margin) return false; continue; }
        const t0 = (centre - s.margin - a) / d, t1 = (centre + s.margin - a) / d;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
        if (lo > hi) return false;
      }
      return true;
    };
    const root = (p) => { while (p && p.alias) p = p.alias; return p; };
    for (const node of network.nodes) {
      if (!node.signalTiming) continue;
      for (const edge of node.in) {
        if (place && staticHeadSites.some((h) => h.site.timing.index === node.signalTiming.index &&
          Math.hypot(h.p.x - node.x, h.p.z - node.z) < 45 &&
          h.a.ux * edge.inArm.ux + h.a.uz * edge.inArm.uz > 0.98)) continue;
        const x = edge.sx + edge.dx * edge.len, z = edge.sz + edge.dz * edge.len;
        const entry = { node, edge, x, z };
        entries.push(entry);
        if (!node.signal || node.signalTiming.disabled || !edge.lanes.length) { entry.class = 'D'; continue; }
        const sameHead = vehicleHeadSites.find((h) => {
          if (root(h.site.timing) !== root(node.signalTiming)) return false;
          const swap = Math.abs(h.site.timing.mainUx * node.signalTiming.mainUx +
            h.site.timing.mainUz * node.signalTiming.mainUz) <= 0.82;
          const ox = h.p.x - x, oz = h.p.z - z;
          return (h.group0 !== swap) === (edge.axisIndex === 0) &&
            -h.a.ux * edge.dx - h.a.uz * edge.dz > 0.9 && Math.hypot(ox, oz) <= headReach &&
            ox * edge.dx + oz * edge.dz <= STOP_SETBACK;
        });
        if (sameHead) { entry.class = 'A'; entry.head = sameHead; continue; }
        // The first pass already serves an approach when a same-phase head on the same plan faces it within 45 m.
        // A head with the other group does not count, or the audit would report A for an approach that still has
        // no signal of its own phase. Pedestrian-only signals run one shared phase for both groups (axisIndex 0),
        // so either group's head serves the approach there.
        const approachHead = vehicleHeadSites.find((h) => {
          if (root(h.site.timing) !== root(node.signalTiming)) return false;
          const swap = Math.abs(h.site.timing.mainUx * node.signalTiming.mainUx +
            h.site.timing.mainUz * node.signalTiming.mainUz) <= 0.82;
          return (node.signalTiming.pedestrian || (h.group0 !== swap) === (edge.axisIndex === 0)) &&
            Math.hypot(h.p.x - node.x, h.p.z - node.z) < 45 &&
            h.a.ux * edge.inArm.ux + h.a.uz * edge.inArm.uz > 0.98;
        });
        if (approachHead) { entry.class = 'A'; entry.head = approachHead; continue; }
        const reasons = {}, candidates = [], walks = index();
        // Cache one neighbourhood per junction, enclosing the candidates on all its incoming edges. The tracks
        // and their links are otherwise lazy; materialising the entire city made signal placement take 19 seconds.
        let reach = 0;
        for (const incoming of node.in) {
          const endX = incoming.sx + incoming.dx * incoming.len, endZ = incoming.sz + incoming.dz * incoming.len;
          reach = Math.max(reach, Math.hypot(endX - node.x, endZ - node.z) + incoming.half + 35);
        }
        for (const track of pedRoutes.segmentsNear(node.x, node.z, reach, node)) addWalk(walks, track);
        let closest = null, sampleCount = 0;
        const failures = (px, pz, stopEarly) => {
          const fail = [];
          const b = blockAt(px, pz);
          const pad = b && b.median ? 0.9 : 0.4;
          const curb = b && !b.underpass && !inPlaza(px, pz, 0.5, true) &&
            [[pad, 0], [-pad, 0], [0, pad], [0, -pad]].every(([ox, oz]) => {
              const q = blockAt(px + ox, pz + oz);
              return q && !!q.median === !!b.median;
            });
          if (!curb) { fail.push('curb'); if (stopEarly) return fail; }
          if (!clearOfRails(px, pz, 0.22)) { fail.push('rail'); if (stopEarly) return fail; }
          const crossing = lookup(crossings, px, pz).some((c) => {
            const dx = c.bx - c.ax, dz = c.bz - c.az, len = Math.hypot(dx, dz);
            const along = ((px - c.ax) * dx + (pz - c.az) * dz) / len;
            const across = Math.abs((px - c.ax) * dz - (pz - c.az) * dx) / len;
            return along > -2.75 && along < len + 2.75 && across < c.h + 0.4;
          });
          if (!clearOfCrosswalks(px, pz, 0.15) || crossing) { fail.push('crosswalk'); if (stopEarly) return fail; }
          if (roadClearance(px, pz) < 0.8) { fail.push('road'); if (stopEarly) return fail; }
          if (!isClearOfPoles(px, pz, 1.4)) { fail.push('furniture'); if (stopEarly) return fail; }
          if (lookup(curves, px, pz).some((p) => Math.abs(p.x - px) < 0.95 && Math.abs(p.z - pz) < 0.95)) {
            fail.push('curve'); if (stopEarly) return fail;
          }
          if (lookup(lanes, px, pz).some((s) => intersects(s, px, pz))) {
            fail.push('lane'); if (stopEarly) return fail;
          }
          if (lookup(walks, px, pz).some((s) => intersects(s, px, pz))) {
            fail.push('pedestrian route'); if (stopEarly) return fail;
          }
          if (lookup(buildings, px, pz).some((c) => px >= c.minX - 0.15 && px <= c.maxX + 0.15 &&
            pz >= c.minZ - 0.15 && pz <= c.maxZ + 0.15)) {
            fail.push('building'); if (stopEarly) return fail;
          }
          return fail;
        };
        // A mast arm may pass over the roadway but not through a tall wall, a bridge deck or the tram envelope.
        // The 0.5 m samples keep the whole arm and head at least 2.22 m from every track centreline
        // (RAIL_PROP_KEEP + 0.22 m), the same rule the pole foot meets; 1.5 m steps missed a head over a rail by 2 m.
        const armClear = (from, to) => {
          const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
          const steps = Math.max(1, Math.ceil(len / 0.5));
          for (let i = 0; i <= steps; i++) {
            const px = from.x + dx * i / steps, pz = from.z + dz * i / steps;
            if (!clearOfRails(px, pz, 0.22)) return false;
            if (lookup(overhead, px, pz).some((c) => px >= c.minX - 0.15 && px <= c.maxX + 0.15 &&
              pz >= c.minZ - 0.15 && pz <= c.maxZ + 0.15)) return false;
          }
          return true;
        };
        // Overhead fallback: pair the head with an existing signal pole or a mast foot on any clear block within
        // 12 m, including medians and sidewalk points 6-12 m from the curb and supports up to 10 m ahead of the stop
        // line. The ordinary search stops at 6 m and misses them. The first search keeps the head at least 8 m before
        // the stop line (the table 7.2 row for a 4.5 m mounting), then a successful arm is retargeted to the stricter
        // 10.5 m row for the 5.3 m head when its reach allows; only when no support reaches either band does the head
        // fall back to the support's position (1.75 m past the stop line at most).
        const findOverhead = () => {
          // Pair the head with the support's longitudinal position, clamped to the ground search's -15 m limit and
          // to the requested visibility band; the head goes over the nearest lane. The arm is not always lateral:
          // 10 of the 26 arms run farther along the approach than across it, and 11 of the 15 fallbacks run
          // 6.25-8.25 m along it.
          const targetFor = (along, lat, maxAlong) => {
            let lane = edge.lanes[0];
            for (const value of edge.lanes) if (Math.abs(value - lat) < Math.abs(lane - lat)) lane = value;
            const t = Math.max(-15, Math.min(maxAlong, along));
            return { x: x + edge.dx * t + edge.rx * lane, z: z + edge.dz * t + edge.rz * lane, along: t };
          };
          // Keep the mast foot 3.1 m from every track as a conservative buffer above the 1.75 m tram-pole and
          // 2.6 m railway-mast setbacks. The later layouts cannot be read here; signal-placement.test.cjs builds
          // them and checks every arm, foot and head against the real poles and masts (closest 7.26 m).
          const mastClear = (px, pz) => clearOfRails(px, pz, 1.1);
          const search = (maxAlong, band, strict = false) => {
            let best = null;
            for (const record of signalArmPoles.values()) for (const item of record.poles) {
              const p = item.p, along = (p.x - x) * edge.dx + (p.z - z) * edge.dz;
              if (along < -15 || along > 10 || !mastClear(p.x, p.z)) continue;
              const lat = (p.x - x) * edge.rx + (p.z - z) * edge.rz;
              const target = targetFor(along, lat, maxAlong);
              const reach = Math.hypot(p.x - target.x, p.z - target.z);
              if (reach > OVERHEAD_REACH || reach < 0.3) continue;
              const score = reach - 3;
              if (best && score >= best.score) continue;
              if (!armClear(p, target)) continue;
              best = { foot: p, existing: true, reach, score, target, band, strict };
            }
            for (let along = -15; along <= 10; along += 1) {
              for (let lat = -edge.half - OVERHEAD_REACH; lat <= edge.half + OVERHEAD_REACH; lat += 0.8) {
                const px = x + edge.dx * along + edge.rx * lat;
                const pz = z + edge.dz * along + edge.rz * lat;
                const target = targetFor(along, lat, maxAlong);
                const reach = Math.hypot(px - target.x, pz - target.z);
                if (reach > OVERHEAD_REACH || reach < 1 || (best && reach >= best.score) ||
                  !mastClear(px, pz)) continue;
                if (failures(px, pz, true).length || !armClear({ x: px, z: pz }, target)) continue;
                best = { foot: { x: px, z: pz }, existing: false, reach, score: reach, target, band, strict };
              }
            }
            return best;
          };
          const band = search(-8, true);
          if (!band) return search(STOP_SETBACK, false);
          if (band.target.along <= -10.5 + 1e-6) return { ...band, strict: true };
          return search(-10.5, true, true) || band;
        };
        // The first clear sample is placed, so the order is the preference: near, narrow sites first, then wider offsets,
        // then further back, where the head is harder to see from the stop line. Placing stops at the first failed
        // rule and the first clear site; the audit (place false) still tallies every rule at every sample.
        sampleLoop: for (const [backs, start, end] of [[[0.75, 1, 1.3], CROSSWALK + 0.5, 16],
          [[1.6, 2, 2.5, 3, 4, 5, 6], CROSSWALK + 0.5, 16],
          [[0.75, 1, 1.3, 1.6, 2, 2.5, 3, 4, 5, 6], 16, 21.1]]) {
          for (const side of [1, -1]) for (const back of backs) for (let dt = start; dt < end; dt += 1.2) {
            const px = x - edge.dx * (dt - CROSSWALK - STOP_SETBACK) + edge.rx * (edge.half + back) * side;
            const pz = z - edge.dz * (dt - CROSSWALK - STOP_SETBACK) + edge.rz * (edge.half + back) * side;
            if (Math.hypot(px - x, pz - z) > headReach ||
              (px - x) * edge.dx + (pz - z) * edge.dz < -15) continue;
            sampleCount++;
            const fail = failures(px, pz, place);
            if (place) {
              if (fail.length) continue;
              candidates.push({ x: px, z: pz, side });
              break sampleLoop;
            }
            for (const reason of fail) reasons[reason] = (reasons[reason] || 0) + 1;
            if (!closest || fail.length < closest.fail.length) closest = { x: px, z: pz, side, fail };
            if (!fail.length) candidates.push({ x: px, z: pz, side });
          }
        }
        entry.class = candidates.length ? 'B' : 'C';
        entry.reasons = reasons; entry.closest = closest; entry.candidate = candidates[0];
        entry.sampleCount = sampleCount;
        if (!place) continue;
        // Prefer a pole without a vehicle head. Right-hand curb before the left-hand fallback.
        let pole = null;
        findPole: for (const side of [1, -1]) {
          for (const record of signalArmPoles.values()) for (const item of record.poles) {
            const p = item.p, ox = p.x - x, oz = p.z - z;
            const along = ox * edge.dx + oz * edge.dz, lateral = (ox * edge.rx + oz * edge.rz) * side;
            if (along < -15 || along > STOP_SETBACK || lateral < edge.half + 0.6 || lateral > edge.half + 2.6 ||
              vehicleHeadSites.some((h) => Math.hypot(h.p.x - p.x, h.p.z - p.z) < 0.1)) continue;
            pole = p; break findPole;
          }
        }
        if (!pole && !candidates.length) {
          const overheadSite = findOverhead();
          if (!overheadSite) continue;
          if (!overheadSite.existing) addOverheadPole(overheadSite.foot);
          else addMastExtension(overheadSite.foot);
          addSignalArm(overheadSite.foot, overheadSite.target);
          const site = { timing: node.signalTiming }, group0 = edge.axisIndex === 0;
          const a = { ux: -edge.dx, uz: -edge.dz, w: edge.half * 2, lanes: edge.lanes.length };
          const target = overheadSite.target;
          const m = setFacing(target.x + a.ux * 0.18, OVERHEAD_Y, target.z + a.uz * 0.18, a.ux, a.uz);
          const head = { site, a, p: target, group0, existing: overheadSite.existing, node, edge,
            overhead: true, pole: overheadSite.foot, m, band: overheadSite.band, strict: overheadSite.strict };
          heads.push(head);
          vehicleHeadSites.push(head);
          entry.class = 'B';
          entry.candidate = { x: target.x, z: target.z, side: 0, overhead: true };
          continue;
        }
        const p = pole || candidates[0];
        if (!pole) addSignalPole(p);
        const site = { timing: node.signalTiming }, group0 = edge.axisIndex === 0;
        const a = { ux: -edge.dx, uz: -edge.dz, w: edge.half * 2, lanes: edge.lanes.length };
        const head = { site, a, p, group0, existing: !!pole, node, edge };
        heads.push(head);
        vehicleHeadSites.push(head);
      }
    }
    return { entries, heads };
  }

  // Some mapped one-way arms acquire an incoming lane only after the network merges and centres the roads. Reuse
  // the left pole that the ordinary search already placed; the network, pedestrian routes and furniture stay fixed.
  function addRuntimeSignalHeads(network, pedRoutes = null) {
    const matrices = [], ave = [], street = [], backplates = [], aveIndices = [], streetIndices = [];
    const planRoot = (plan) => {
      while (plan && plan.alias) plan = plan.alias;
      return plan;
    };
    for (const node of network.nodes) {
      if (!node.signal || !node.signalTiming || node.signalTiming.disabled) continue;
      const nodePlan = planRoot(node.signalTiming);
      for (const edge of node.in) {
        const arm = edge.inArm;
        const nearby = vehicleHeadSites.filter((h) => planRoot(h.site.timing) === nodePlan &&
          Math.hypot(h.p.x - node.x, h.p.z - node.z) < 45);
        if (nearby.some((h) => h.a.ux * arm.ux + h.a.uz * arm.uz > 0.98)) continue;
        const endX = edge.sx + edge.dx * edge.len, endZ = edge.sz + edge.dz * edge.len;
        const isRight = (p) => (p.x - endX) * edge.rx + (p.z - endZ) * edge.rz > Math.max(...edge.lanes);
        // A head may serve the actual lane even when the paired runtime arm points along its outgoing half.
        if (nearby.some((h) => {
          const swapped = Math.abs(h.site.timing.mainUx * node.signalTiming.mainUx +
            h.site.timing.mainUz * node.signalTiming.mainUz) <= 0.82;
          const samePhase = node.signalTiming.pedestrian || (h.group0 !== swapped) === (edge.axisIndex === 0);
          return samePhase && isRight(h.p) && -h.a.ux * edge.dx - h.a.uz * edge.dz > 0.82;
        })) continue;
        let best = null, closest = -Infinity;
        for (const candidate of node.signalArms || []) {
          const dot = arm.ux * candidate.arm.ux + arm.uz * candidate.arm.uz;
          if (dot > closest) { closest = dot; best = candidate; }
        }
        const record = best && signalArmPoles.get(best.arm);
        if (closest <= 0.9 || !record || record.hasHead || record.poles.some(({ p }) => isRight(p))) continue;
        const left = record.poles.find(({ side }) => side === -1);
        if (!left) continue;
        const a = best.arm, p = left.p, site = record.site, timing = site.timing;
        const group0 = Math.abs(a.ux * timing.mainUx + a.uz * timing.mainUz) > 0.82;
        const m = signalHeadMatrix(p, a);
        const index = (timing.index + 0.5) / Math.max(1, SIGNAL_PLANS.length);
        matrices.push(m);
        (group0 ? ave : street).push(m);
        (group0 ? aveIndices : streetIndices).push(index);
        if (a.w >= 14.5 || a.lanes >= 3) backplates.push(m);
        record.hasHead = true;
        vehicleHeadSites.push({ site, a, p, group0 });
      }
    }
    if (pedRoutes) {
      const poleStart = signalPoleMatrices.length;
      const additions = auditRuntimeSignalHeads(network, pedRoutes, true);
      result.runtimeHeads.push(...additions.heads);
      for (const head of additions.heads) {
        const { site, a, p, group0 } = head;
        const m = head.m || signalHeadMatrix(p, a);
        const index = (site.timing.index + 0.5) / Math.max(1, SIGNAL_PLANS.length);
        matrices.push(m);
        (group0 ? ave : street).push(m);
        (group0 ? aveIndices : streetIndices).push(index);
        if (a.w >= 14.5 || a.lanes >= 3) backplates.push(m);
      }
      addMatrixArrayInstanced(unitCyl, signalPoleMat, signalPoleMatrices.slice(poleStart));
    }
    addMatrixArrayInstanced(s1HousingGeo, signalHousingMat, matrices);
    addMatrixArrayInstanced(backplateGeo, signalHousingMat, backplates);
    addMatrixArrayInstanced(backplateBorderGeo, backplateBorderMat, backplates);
    addMatrixArrayInstanced(s1LensGeo, aveSignalLensMat, ave, false, signalAttrs(aveIndices));
    addMatrixArrayInstanced(s1LensGeo, streetSignalLensMat, street, false, signalAttrs(streetIndices));
    result.vehicleHeads += matrices.length;
    return matrices.length;
  }
  scene.add(group);
  const result = { group, footprints, colliders, signalClock, audioSignals, treePlacement, roadNetwork: treeNetwork,
    vehicleHeads: s1Matrices.length, runtimeHeads: [], addRuntimeSignalHeads, auditRuntimeSignalHeads, update };
  return result;
}

export { buildStreetDetails, plateLabel };
