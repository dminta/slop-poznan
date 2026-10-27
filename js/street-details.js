import * as THREE from 'three/webgpu';
import { Fn, float, color, uniform, mod, fract, step, smoothstep, mix, uv, texture, attribute, vec2, floor, sin, positionWorld } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGNAL_SITES, SIGNAL_TIMING, blockAt, BLOCKS, nearestRoads, roadClearance, LANDMARK_SITES } from './city-config.js';
import { cityUniforms, createTreeGrateMaterial } from './tsl-materials.js';
import { createTreeField } from './trees.js';
import { pavedPlazaRects, parkTreeSites, parkLampSites } from './city-grid.js';

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

// Street name plates: one 256 x 64 cell per name, white on blue with a white rule
const PLATE_CELL = [256, 64];
function createPlateAtlas(labels) {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  const c = document.createElement('canvas');
  c.width = cols * PLATE_CELL[0];
  c.height = rows * PLATE_CELL[1];
  const ctx = c.getContext('2d');
  labels.forEach((label, i) => {
    const x0 = (i % cols) * PLATE_CELL[0];
    const y0 = Math.floor(i / cols) * PLATE_CELL[1];
    ctx.fillStyle = '#1b3f8c';
    ctx.fillRect(x0, y0, PLATE_CELL[0], PLATE_CELL[1]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 5, y0 + 5, PLATE_CELL[0] - 10, PLATE_CELL[1] - 10);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 30;
    ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    while (size > 12 && ctx.measureText(label).width > PLATE_CELL[0] - 24) {
      size -= 2;
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    }
    ctx.fillText(label, x0 + PLATE_CELL[0] / 2, y0 + PLATE_CELL[1] / 2 + 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cols, rows };
}

// "ul. Garbary", "al. Niepodległości"; squares, roundabouts and bridges keep their own word
function plateLabel(name) {
  if (/^Alej[ae]\s/i.test(name)) return `al. ${name.replace(/^\S+\s+/, '')}`;
  if (/^(Rondo|Most|Plac|Rynek|Osiedle|Wybrzeże|Bulwar|Park|Skwer)\b/i.test(name)) return name;
  return `ul. ${name}`;
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

/**
 * S-1 signal lens material: the lens geometry carries its lamp in uv.y (1 red at the top, 0.5 amber, 0 green), so
 * heads can stand at any height or turn. Driven by the shared signal clock and SIGNAL_TIMING (city-config.js), which
 * js/traffic.js obeys; red and amber light together for the last redAmber seconds of the red.
 */
function createTrafficSignalLensMaterial(isAvenueHead, clock) {
  const { cycle, avenueAmber, avenueRed, streetAmber, redAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const lamp = uv().y;
    const isTopRed = step(0.75, lamp);
    const isBottomGreen = float(1.0).sub(step(0.25, lamp));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Group 0 ("avenue"): green, then amber from avenueAmber, red from avenueRed
    // Group 1: red until avenueRed, then green, amber from streetAmber
    // Both: the amber lights up beside the red for the last redAmber seconds of the red (red+amber, then green)
    const greenActive = isAvenueHead
      ? float(1.0).sub(step(avenueAmber, t))
      : step(avenueRed, t).mul(float(1.0).sub(step(streetAmber, t)));
    const amberActive = isAvenueHead
      ? step(avenueAmber, t).mul(float(1.0).sub(step(avenueRed, t))).add(step(cycle - redAmber, t))
      : step(streetAmber, t).add(step(avenueRed - redAmber, t).mul(float(1.0).sub(step(avenueRed, t))));
    const redActive = isAvenueHead
      ? step(avenueRed, t)
      : float(1.0).sub(step(avenueRed, t));

    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));

    const lensHue = mix(
      mix(color(0x18ff68), color(0xffaa10), isMidAmber),
      color(0xff2424),
      isTopRed
    );
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

// Pedestrian head for walking alongside group 0 (isAvenue) or group 1 traffic, as walkSignal (city-config.js): a
// steady green figure for `walk` seconds from the start of that green, a flashing one until its amber, then the red
// figure. uv.y above 0.5 is the red (top) chamber, below it the green; the figure texture is the mask.
function createWalkSignalMaterial(clock, isAvenue, figureTex) {
  const { cycle, avenueAmber, avenueRed, walk } = SIGNAL_TIMING;
  const offset = isAvenue ? 0 : avenueRed;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock.add(cycle - offset), cycle);
    const steady = float(1.0).sub(step(walk, t));
    const greenPhase = float(1.0).sub(step(avenueAmber, t));
    const greenLit = steady.add(greenPhase.sub(steady).mul(step(0.5, fract(t))));
    const isRed = step(0.5, uv().y);
    const lit = mix(greenLit, float(1.0).sub(greenPhase), isRed);
    const hue = mix(color(0x30ff8c), color(0xff2a20), isRed);
    const mask = texture(figureTex, uv()).r;
    return mix(color(0x0d0f11), mix(hue.mul(0.08), hue.mul(1.4), lit), mask);
  })();
  return mat;
}

function buildStreetDetails(scene, { buildingColliders = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'StreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of (`kind` is for measuring)
  const footprints = [];
  const addFootprint = (x, z, w, d, kind = 'other') =>
    footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, kind });

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);

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
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  const figureTex = createPedestrianFigureTexture();
  const aveWalkMat = createWalkSignalMaterial(signalClock, true, figureTex);
  const streetWalkMat = createWalkSignalMaterial(signalClock, false, figureTex);
  // LED luminaire lens and gas lantern glass: pale by day, lit after dusk (the gas a warmer, yellower white)
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const gasGlassGlow = new THREE.MeshBasicNodeMaterial();
  gasGlassGlow.colorNode = mix(color(0xc9ccc4), color(0xffdc9a).mul(1.9), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const castIronMat = new THREE.MeshStandardNodeMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0.55 });

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
  //    One pole on the right-hand curb of every arm traffic arrives over, just past the corner (by the crosswalk and
  //    the stop line), carrying the S-1 head facing that traffic and a pedestrian head facing across the arm; one on
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
  const audioSignals = [];
  const plateSites = []; // { x, z, nx, nz, label }
  const ledLampSites = [];
  const streetPointSites = [];
  const placedPoles = [];

  const plazaRects = pavedPlazaRects || [];
  const inPlaza = (x, z, m = 1.0) =>
    plazaRects.some((r) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m);

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
    for (let i = 0; i < placedPoles.length; i++) {
      const dx = placedPoles[i].x - x;
      const dz = placedPoles[i].z - z;
      if (dx * dx + dz * dz < md2) return false;
    }
    return true;
  };

  // Lanes are laid out along the road graph's runs (road-network.js: from merged junction centres, at the links' own
  // widths), which in places reach past a block's curb outline, most near junctions: a prop of radius r also keeps
  // outside them (city-config.js roadClearance), with 0.3 m for the runs' shape nodes straying from the real bends
  const clearOfRoads = (x, z, r) => roadClearance(x, z) >= r + 0.3;

  // A signal pole may stand on a sidewalk 0.4 m clear of its curb, or in the middle of a median at least 1.8 m wide
  // (0.9 m clear: lanes keep LANE_CLEAR 1.2 m from their centrelines, which stand >= 1.2 m inside the curbs)
  const signalPoleSpot = (x, z) => {
    const b = blockAt(x, z);
    if (!b || inPlaza(x, z, 0.5) || !isClearOfPoles(x, z, 1.4) || !clearOfRoads(x, z, 0.35)) return false;
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

  const builtJunctions = new Set();
  for (const site of SIGNAL_SITES) {
    if (builtJunctions.has(site.junction)) continue;
    builtJunctions.add(site.junction);
    const arms = site.arms || [];
    // signal groups: arms of one road, ranked like road-network.js sidesAndGroups (major roads first, then width)
    const road = arms.map((_, i) => i);
    const findRoad = (i) => (road[i] === i ? i : (road[i] = findRoad(road[i])));
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        if (Math.abs(arms[i].ux * arms[j].ux + arms[i].uz * arms[j].uz) > 0.82) road[findRoad(i)] = findRoad(j);
      }
    }
    const rank = new Map();
    arms.forEach((a, i) => {
      const v = (a.w >= 14.5 || a.lanes >= 3 ? 100 : 0) + a.w / 2;
      rank.set(findRoad(i), Math.max(rank.get(findRoad(i)) || 0, v));
    });
    let top = -1;
    let topRank = -Infinity;
    for (const [r, v] of rank) {
      if (v > topRank) {
        topRank = v;
        top = r;
      }
    }

    arms.forEach((a, i) => {
      const group0 = findRoad(i) === top;
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
      const spot = (side) => {
        for (const back of [0.75, 1.3]) {
          for (const dt of [1.2, 2.4, 3.6, 4.8]) {
            const t = corner + dt;
            const x = a.x + a.ux * t + rx * (half + back) * side;
            const z = a.z + a.uz * t + rz * (half + back) * side;
            if (signalPoleSpot(x, z)) return { x, z };
          }
        }
        return null;
      };
      const big = a.w >= 14.5 || a.lanes >= 3;
      for (const side of [1, -1]) {
        const p = spot(side);
        if (!p) continue;
        placedPoles.push(p);
        addFootprint(p.x, p.z, 0.3, 0.3, 'signal');
        dummy.position.set(p.x, 0.1 + SIGNAL_POLE_H / 2, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.055, SIGNAL_POLE_H, 0.055);
        dummy.updateMatrix();
        signalPoleMatrices.push(dummy.matrix.clone());
        // vehicle head facing the arriving traffic (on the left only as a repeater on wide arms)
        if (a.inbound && (side === 1 || a.w >= 12 || a.lanes >= 3)) {
          const m = setFacing(p.x + a.ux * 0.18, S1_Y, p.z + a.uz * 0.18, a.ux, a.uz);
          s1Matrices.push(m);
          (group0 ? s1AveMatrices : s1StreetMatrices).push(m);
          if (big) backplateMatrices.push(m);
        }
        // pedestrian head facing across the arm, for the people waiting on the other curb
        const fx = -rx * side;
        const fz = -rz * side;
        const m = setFacing(p.x + fx * 0.17, PED_Y, p.z + fz * 0.17, fx, fz);
        pedHeadMatrices.push(m);
        (group0 ? pedStreetMatrices : pedAveMatrices).push(m);
        // these heads' WALK is the other group's (walkSignal isAvenue); unplaced poles never become sound sources
        audioSignals.push({ x: p.x + fx * 0.17, y: PED_Y, z: p.z + fz * 0.17, isAvenue: !group0 });
      }
      // Street name plates for the corner buildings either side of the arm (1B)
      if (a.name) {
        for (const side of [1, -1]) {
          plateSites.push({ t: corner + 3.5, a, side, label: plateLabel(a.name) });
        }
      }
    });
  }

  // =========================================================================
  // 1B. STREET NAME PLATES ON THE CORNER BUILDINGS
  //     From the curb just past each signalised corner, a ray across the sidewalk finds the first building wall
  //     (buildingColliders: the city-block and landmark colliders main.js hands over) within 14 m; the plate goes on
  //     it at 3.3 m, facing the street it names. Nearby plates of one name are dropped; with no colliders (tests) there
  //     are no plates.
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
  const plateMatrices = [];
  const plateCells = [];
  const plateLabels = [];
  const placedPlates = [];
  if (wallGrid.size) {
    for (const { t, a, side, label } of plateSites) {
      const rx = a.uz * side;
      const rz = -a.ux * side;
      const x = a.x + a.ux * t + rx * (a.w / 2 + 0.3);
      const z = a.z + a.uz * t + rz * (a.w / 2 + 0.3);
      if (!blockAt(x + rx * 0.6, z + rz * 0.6)) continue;
      const hit = wallHit(x, z, rx, rz, 14);
      // only a wall facing back to the street, not a party wall seen edge-on
      if (!hit || hit.nx * -rx + hit.nz * -rz < 0.7) continue;
      const wx = x + rx * hit.t + hit.nx * 0.03;
      const wz = z + rz * hit.t + hit.nz * 0.03;
      if (placedPlates.some((p) => p.label === label && Math.hypot(p.x - wx, p.z - wz) < 25)) continue;
      placedPlates.push({ x: wx, z: wz, label });
      let cell = plateLabels.indexOf(label);
      if (cell < 0) cell = plateLabels.push(label) - 1;
      plateCells.push(cell % 8, Math.floor(cell / 8));
      plateMatrices.push(setFacing(wx, 3.3, wz, hit.nx, hit.nz));
    }
  }

  // =========================================================================
  // 2. STREETLIGHTS ALONG EVERY CURB, BY STREET CLASS
  //    Walked along the true curb edges of every city block (BLOCKS poly), whatever their bearing, and verified with
  //    blockAt(x, z) so no pole ever stands in a roadway. Each edge takes the class of the road it fronts
  //    (nearestRoads): main streets (>= 12.5 m curb to curb, three lanes or more, or a trunk road) get 10 m LED bent
  //    masts every ~34 m, other streets 7 m ones every ~30 m, except in the Old Town and on Ostrów Tumski, where they
  //    get the historic gas lanterns Poznań still lights, every ~22 m. Poles stand ~1 m inside the curb, their
  //    footprints clear of the lanes (LANE_CLEAR).
  // =========================================================================
  // The Old Town as buildings.js draws it (OLD_TOWN_BOX: Stare Miasto east of al. Marcinkowskiego, with Garbary and
  // Chwaliszewo), and Ostrów Tumski / Śródka within 650 m of the Katedra
  const OLD_TOWN_BOX = { x0: -330, x1: 900, z0: -900, z1: 600 };
  const KATEDRA = LANDMARK_SITES && LANDMARK_SITES.Katedra;
  const inOldTown = (b, x, z) =>
    (b.district === 'Stare Miasto' && x > OLD_TOWN_BOX.x0 && x < OLD_TOWN_BOX.x1 && z > OLD_TOWN_BOX.z0 && z < OLD_TOWN_BOX.z1) ||
    (!!KATEDRA && Math.hypot(x - KATEDRA.x, z - KATEDRA.z) < 650);
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

  const LAMP_CLASS = { main: { scale: 1, sp: 34 }, side: { scale: 0.7, sp: 30 } };
  const GAS_SP = 22;
  const mastMatrices = [];
  const ledHeadMatrices = [];
  const gasPostMatrices = [];
  const lampCount = { main: 0, side: 0, old: 0 };
  for (const { p0, dx, dz, len, inx, inz, outX, outZ, cls } of curbEdges) {
    if (cls === 'old') {
      const m = Math.max(1, Math.floor(len / GAS_SP));
      for (let j = 0; j < m; j++) {
        const f = (j + 0.5) / m;
        const cx = p0.x + dx * f;
        const cz = p0.z + dz * f;
        const px = cx + inx * 0.9;
        const pz = cz + inz * 0.9;
        if (!isOnSidewalk(px, pz, 0.5) || blockAt(cx + outX * 2.2, cz + outZ * 2.2) || !isClearOfPoles(px, pz, 5.2) ||
          !clearOfRoads(px, pz, 0.25)) continue;
        placedPoles.push({ x: px, z: pz });
        addFootprint(px, pz, 0.4, 0.4, 'gas');
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
    const n = Math.max(1, Math.floor(len / sp));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const cx = p0.x + dx * f;
      const cz = p0.z + dz * f;
      const lx = cx + inx * 1.08;
      const lz = cz + inz * 1.08;
      const headX = lx + outX * LED_REACH * scale;
      const headZ = lz + outZ * LED_REACH * scale;
      if (
        !isOnSidewalk(lx, lz, 0.55) ||
        !clearOfRoads(lx, lz, 0.3) ||
        blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
        blockAt(headX, headZ) ||
        !isClearOfPoles(lx, lz, 6.5)
      ) {
        continue;
      }
      placedPoles.push({ x: lx, z: lz });
      addFootprint(lx, lz, 0.45, 0.45, 'led');
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

  addMatrixArrayInstanced(unitCyl, signalPoleMat, signalPoleMatrices);
  addMatrixArrayInstanced(s1HousingGeo, signalHousingMat, s1Matrices);
  addMatrixArrayInstanced(backplateGeo, signalHousingMat, backplateMatrices);
  addMatrixArrayInstanced(backplateBorderGeo, backplateBorderMat, backplateMatrices);
  addMatrixArrayInstanced(s1LensGeo, aveSignalLensMat, s1AveMatrices, false);
  addMatrixArrayInstanced(s1LensGeo, streetSignalLensMat, s1StreetMatrices, false);
  addMatrixArrayInstanced(pedHousingGeo, signalHousingMat, pedHeadMatrices);
  addMatrixArrayInstanced(pedPanelGeo, aveWalkMat, pedAveMatrices, false);
  addMatrixArrayInstanced(pedPanelGeo, streetWalkMat, pedStreetMatrices, false);
  addMatrixArrayInstanced(bentMastGeo, poleMetalMat, mastMatrices);
  addMatrixArrayInstanced(ledHousingGeo, poleMetalMat, ledHeadMatrices);
  addMatrixArrayInstanced(ledLensGeo, lampBulbGlow, ledHeadMatrices, false);
  addMatrixArrayInstanced(gasPostGeo, castIronMat, gasPostMatrices);
  addMatrixArrayInstanced(gasGlassGeo, gasGlassGlow, gasPostMatrices, false);
  if (plateMatrices.length) {
    const atlas = createPlateAtlas(plateLabels);
    const plateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
    const cell = attribute('plateCell', 'vec2');
    // canvas row 0 is the texture's top (flipY)
    plateMat.colorNode = texture(atlas.tex, uv().add(vec2(cell.x, float(atlas.rows - 1).sub(cell.y))).div(vec2(atlas.cols, atlas.rows)));
    addMatrixArrayInstanced(new THREE.PlaneGeometry(0.92, 0.23).translate(0, 0, 0.013), plateMat, plateMatrices, false,
      { plateCell: { size: 2, data: plateCells } });
    addMatrixArrayInstanced(new THREE.BoxGeometry(0.96, 0.27, 0.024), poleMetalMat, plateMatrices, false);
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
  const place = (list, p, yaw, w, kind, clear) => {
    if (!isClearOfPoles(p.x, p.z, clear) || !clearOfRoads(p.x, p.z, w / 2 + 0.05)) return false;
    placedPoles.push(p);
    addFootprint(p.x, p.z, w, w, kind);
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
      let ok = isClearOfPoles(x, z, halfW + 1.5);
      for (const [a, c] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (!ok) break;
        const qx = x + ux * halfW * a + inx * (halfD + 0.3) * c;
        const qz = z + uz * halfW * a + inz * (halfD + 0.3) * c;
        ok = blockAt(qx, qz) === b && !inLot(b, qx, qz, 0.3) && !inPlaza(qx, qz, 0.5);
      }
      if (!ok) continue;
      bigSites.push({ x, z, kind });
      placedPoles.push({ x, z });
      const w = Math.abs(ux) * halfW * 2 + Math.abs(inx) * halfD * 2;
      const d = Math.abs(uz) * halfW * 2 + Math.abs(inz) * halfD * 2;
      addFootprint(x, z, w, d, kind);
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
    `${signalPoleMatrices.length} poles at ${builtJunctions.size} junctions, ${plateMatrices.length} name plates; lamps ` +
    `${lampCount.main} main, ${lampCount.side} side, ${lampCount.old} gas; ${hydrantMatrices.length} hydrants, ` +
    `${postBoxMatrices.length} post boxes, ${parkingMatrices.length} parking machines, ${bollardMatrices.length} bollards, ` +
    `${kioskMatrices.length} kiosks, ${flowerMatrices.length} flower stands, ${columnMatrices.length} advertising columns`);


  // =========================================================================
  // 4. TREES: PARKS, SQUARES & PLAZAS, AND STREET TREES ALONG THE CURBS
  //    (one unified trunk + crown instanced mesh per species & band, js/trees.js)
  // =========================================================================
  const treePositions = []; // { x, y, z, scale, species (0 lime, 1 Norway maple, 2 horse chestnut) }
  const mixSpecies = (r, lime, maple) => (r < lime ? 0 : (r < lime + maple ? 1 : 2));

  // A. The parks, squares & plazas (sites laid out by city-grid.js, plus buildings.js's leftover slabs)
  for (const s of parkTreeSites || []) treePositions.push(s);

  // B. Street trees on the raised sidewalks of every real block, along each curb edge: small trees close to the curb
  //    on the narrow streets (a block across within ~14 m), limes, maples & chestnuts on the wider ones, with random
  //    missing trees and the odd unplanted edge; sparse in Stare Miasto's narrow lanes. Never in plazas or parks.
  const sidewalkTreePositions = [];
  const SIDEWALK_Y = 0.22;
  const onSidewalk = (x, z) => {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6) && !b.median;
  };
  // Street trees turn in 90° steps with the crown squeezed across the sidewalk, away from the facades
  function addStreetTree(x, z, scale, species, acrossX, extra = {}) {
    if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2)) return;
    const q = Math.floor(hashPos(x, 8.8, z) * 3.999);
    const t = { x, y: SIDEWALK_Y, z, scale, species, yaw: q * Math.PI * 0.5, tier: 1, ...extra };
    if (acrossX === (q % 2 === 0)) t.sx = extra.squeeze || 0.82;
    else t.sz = extra.squeeze || 0.82;
    treePositions.push(t);
    sidewalkTreePositions.push(t);
  }
  const TREE_SP = 15;
  for (const { b, p0, dx, dz, len, inx, inz, outX, outZ } of curbEdges) {
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
      const x = p0.x + dx * u + inx * inset;
      const z = p0.z + dz * u + inz * inset;
      const r = hashPos(x, 6.1, z);
      if (r < thin) continue;
      const species = narrow ? 1 : mixSpecies(hashPos(z, 2.9, x), 0.4, 0.35);
      const scale = narrow ? 0.54 + r * 0.1 : 0.6 + r * 0.24;
      addStreetTree(x, z, scale, species, acrossX, { tier: narrow ? 2 : 1, pitRot, grate: !narrow, pitS: narrow ? 0.7 : 1, squeeze: narrow ? 0.7 : 0.82 });
    }
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

  scene.add(group);
  return { group, footprints, signalClock, audioSignals, update };
}

export { buildStreetDetails };
