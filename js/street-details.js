import * as THREE from 'three/webgpu';
import { Fn, float, color, positionWorld, uniform, mod, fract, step, smoothstep, mix } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGNAL_SITES, SIGNAL_TIMING, blockAt, BLOCKS } from './city-config.js';
import { cityUniforms, createTreeGrateMaterial } from './tsl-materials.js';
import { createTreeField } from './trees.js';
import { pavedPlazaRects, parkTreeSites, parkLampSites } from './city-grid.js';

// js/street-details.js
// Street furniture, instanced (a generic set until the Poznań furniture of a later phase):
// - cantilevered traffic signal masts with walk signals at the signalised junctions (city-config.js SIGNAL_SITES)
// - cobra-head LED streetlights along every curb, post-top globe lanterns in Stare Miasto
// - fire hydrants, park and street trees, and the pooled street lights that follow the camera

function createStreetSignBladeTexture(label) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d6b3f';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * TSL 3-Aspect Traffic Signal Lens Material (Red y=5.78, Amber y=5.42, Green y=5.06)
 * Driven by the shared signal clock and SIGNAL_TIMING (city-config.js), which js/traffic.js obeys.
 */
function createTrafficSignalLensMaterial(isAvenueHead, clock) {
  const { cycle, avenueAmber, avenueRed, streetAmber, redAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const wy = positionWorld.y;
    const isTopRed = step(5.60, wy);
    const isBottomGreen = float(1.0).sub(step(5.24, wy));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Avenue phase: Green, then Amber from avenueAmber, Red from avenueRed
    // Street phase: Red until avenueRed, then Green, Amber from streetAmber
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

// Pedestrian signal for crossing alongside the avenue: WALK, then a flashing hand until the avenue's amber, then a
// steady hand
function createWalkSignalMaterial(clock) {
  const { cycle, avenueAmber, walk } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const isWalk = float(1.0).sub(step(walk, t));
    const isFlashing = step(walk, t).mul(float(1.0).sub(step(avenueAmber, t)));
    const handLit = float(1.0).sub(isFlashing.mul(step(0.5, fract(t))));
    const hand = mix(color(0x14181e), color(0xff5518), handLit);
    return mix(hand, color(0xf4f9ff), isWalk);
  })();
  return mat;
}

function buildStreetDetails(scene) {
  const group = new THREE.Group();
  group.name = 'StreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3b4046,
    roughness: 0.45,
    metalness: 0.78
  });
  const signalHousingMat = new THREE.MeshStandardNodeMaterial({
    color: 0xe6a817, // marigold yellow housing
    roughness: 0.38,
    metalness: 0.35,
    side: THREE.DoubleSide // the tunnel visors are open half-tubes
  });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  const walkSignalGlow = createWalkSignalMaterial(signalClock);
  // Cobra-head LED streetlight lens & pedestrian post-top globe: pale diffuser by day, warm white after dusk
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const pedGlobeGlow = new THREE.MeshBasicNodeMaterial();
  pedGlobeGlow.colorNode = mix(color(0xd4d2c8), color(0xffe4b0).mul(1.95), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const streetBladeMat = new THREE.MeshStandardNodeMaterial({
    map: createStreetSignBladeTexture('ŚW. MARCIN'),
    roughness: 0.32
  });

  // 12-inch three-section signal head (origin at its centre, y = 5.42): yellow housing, a tunnel visor over each lens
  // and a hanger to the mast arm, lenses on both faces (+-z) so it reads from both approaches; the lens material
  // picks red / amber / green from each lens's world height (5.78 / 5.42 / 5.06)
  const HEAD_W = 0.4;
  const HEAD_H = 1.12;
  const HEAD_D = 0.28;
  const LENS_R = 0.145;
  const LENS_Y = [0.36, 0, -0.36];
  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  const signalHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    new THREE.BoxGeometry(0.07, 0.2, 0.07).translate(0, HEAD_H / 2 + 0.1, 0),
    ...LENS_Y.flatMap((ly) => bothFaces(
      new THREE.CylinderGeometry(LENS_R + 0.03, LENS_R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2).translate(0, ly, HEAD_D / 2 + 0.12)
    ))
  ].map((g) => g.toNonIndexed()));
  const signalLensGeo = mergeGeometries(LENS_Y.flatMap((ly) => bothFaces(new THREE.CircleGeometry(LENS_R, 18).translate(0, ly, HEAD_D / 2 + 0.004))));
  // Pedestrian signal: housing with the WALK / hand face lit on both sides (+-z, toward the crosswalk's far end)
  const walkHousingGeo = new THREE.BoxGeometry(0.34, 0.4, 0.24);
  const walkPanelGeo = mergeGeometries(bothFaces(new THREE.PlaneGeometry(0.27, 0.31).translate(0, 0, 0.125)));
  // Cobra-head luminaire on the end of the arm: flattened grey housing, flat lens underneath
  const lampHousingGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.2, 0.3);
  const lampLensGeo = new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2).scale(0.6, 1, 0.24).translate(0, -0.005, 0);
  // Cast-iron pedestrian post-top globe lightpole (fluted base + shaft + decorative capital + opal globe)
  const pedLampPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, 0.85, 10).translate(0, 0.425, 0),
    new THREE.CylinderGeometry(0.065, 0.085, 2.75, 10).translate(0, 2.22, 0),
    new THREE.CylinderGeometry(0.14, 0.07, 0.16, 10).translate(0, 3.62, 0)
  ].map((g) => g.toNonIndexed()));
  const pedGlobeGeo = new THREE.SphereGeometry(0.23, 12, 10).translate(0, 3.84, 0);

  // =========================================================================
  // 1. CANTILEVERED TRAFFIC SIGNALS, STREET BLADES & WALK SIGNALS
  //    At each signal site, on the NE and SW corners, the arm reaching along x over the north-south road (the
  //    "avenue" phase of SIGNAL_TIMING). Junctions off the axes keep the same layout: a mast is skipped unless it
  //    stands on a curb island (blockAt) with its arm over open roadway, so none stands in a road
  // =========================================================================
  const poleMatrices = [];
  const armMatrices = [];
  const yellowBoxMatrices = [];
  const aveLensMatrices = [];
  const streetLensMatrices = [];
  const streetBladeMatrices = [];
  const walkBoxMatrices = [];
  const audioSignals = [];
  const lampHeadMatrices = [];
  const pedPostMatrices = [];
  const cobraLampSites = [];
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

  for (const site of SIGNAL_SITES) {
    const cornerOffsetX = site.nsWidth * 0.5 + 1.25;
    const cornerOffsetZ = site.ewWidth * 0.5 + 1.25;

    // Place diagonal pair of traffic signal masts at NE and SW corners of every intersection
    const corners = [
      { sx: 1, sz: -1, armDir: -1 },
      { sx: -1, sz: 1, armDir: 1 }
    ];

    for (const c of corners) {
      let px = site.x + c.sx * cornerOffsetX;
      let pz = site.z + c.sz * cornerOffsetZ;
      if (!isOnCurbIsland(px, pz, 0.55) || inPlaza(px, pz, 1.0)) {
        // Try nudging slightly deeper into the block corner if clipped near the curb
        const altX = site.x + c.sx * (cornerOffsetX + 0.85);
        const altZ = site.z + c.sz * (cornerOffsetZ + 0.85);
        if (isOnCurbIsland(altX, altZ, 0.55) && !inPlaza(altX, altZ, 1.0)) {
          px = altX;
          pz = altZ;
        } else {
          continue;
        }
      }
      // Ensure the cantilevered mast arm actually overhangs the avenue roadway
      if (blockAt(px + c.armDir * 3.1, pz) || !isClearOfPoles(px, pz, 6.0)) continue;
      placedPoles.push({ x: px, z: pz });
      addFootprint(px, pz, 0.5, 0.5);

      // Vertical pole (6.4m tall)
      dummy.position.set(px, 3.3, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.14, 6.4, 0.14);
      dummy.updateMatrix();
      poleMatrices.push(dummy.matrix.clone());

      // Street name sign blade mounted on the pole (y = 4.65m)
      dummy.position.set(px + c.armDir * 0.68, 4.65, pz);
      dummy.scale.set(1.38, 0.34, 0.08);
      dummy.updateMatrix();
      streetBladeMatrices.push(dummy.matrix.clone());

      // Pedestrian "WALK / DON'T WALK" signal on the pole at crosswalk level (y = 3.15m), facing across the street
      dummy.position.set(px + c.armDir * 0.24, 3.15, pz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      walkBoxMatrices.push(dummy.matrix.clone());
      // These panels share the avenue WALK phase; rejected/unplaced poles never become sound sources.
      audioSignals.push({ x: dummy.position.x, y: dummy.position.y, z: dummy.position.z, isAvenue: true });

      // Cantilever horizontal mast arm reaching 6.5m over the avenue
      const armX = px + c.armDir * 3.25;
      dummy.position.set(armX, 6.1, pz);
      dummy.scale.set(6.5, 0.11, 0.11);
      dummy.updateMatrix();
      armMatrices.push(dummy.matrix.clone());

      // Intersection corner cobra-head luminaire overhanging the crosswalk & corner sidewalk
      const cornerLampX = px + c.armDir * 1.85;
      dummy.position.set(cornerLampX, 6.22, pz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lampHeadMatrices.push(dummy.matrix.clone());
      cobraLampSites.push({
        x: cornerLampX,
        y: 6.18,
        z: pz,
        tx: px + c.armDir * 2.8,
        tz: pz - c.sz * 1.4
      });

      // Two yellow signal heads hanging from the mast arm: the avenue's (3.1 m out, facing up & down the avenue)
      // and the cross street's (5.5 m out, turned to face along the street)
      for (const armDist of [3.1, 5.5]) {
        dummy.position.set(px + c.armDir * armDist, 5.42, pz);
        dummy.rotation.set(0, armDist < 4.0 ? 0 : Math.PI / 2, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        yellowBoxMatrices.push(dummy.matrix.clone());
        (armDist < 4.0 ? aveLensMatrices : streetLensMatrices).push(dummy.matrix.clone());
      }
      dummy.rotation.set(0, 0, 0);
    }
  }

  // =========================================================================
  // 2. STREETLIGHTS ALONG EVERY CURB
  //    Walked along the true curb edges of every city block (BLOCKS poly), whatever their bearing, and verified with
  //    blockAt(x, z) so no pole ever stands in a roadway: cobra-heads every ~36 m, cast-iron post-top globes between
  //    them in Stare Miasto. Poles stand >= 1 m inside the curb, their footprints clear of the lanes (LANE_CLEAR).
  // =========================================================================
  // Curb edges >= 24 m long that front an open roadway: { b, p0, dx, dz, len, inx, inz, outX, outZ }
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
      curbEdges.push({ b, p0, dx, dz, len, inx, inz, outX: -inx, outZ: -inz });
    }
  }

  const COBRA_SP = 36;
  const GLOBE_SP = 24;
  for (const { b, p0, dx, dz, len, inx, inz, outX, outZ } of curbEdges) {
    const armYaw = Math.atan2(-outZ, outX);
    const n = Math.max(1, Math.floor(len / COBRA_SP));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const cx = p0.x + dx * f;
      const cz = p0.z + dz * f;
      const lx = cx + inx * 1.08;
      const lz = cz + inz * 1.08;
      const headX = lx + outX * 2.6;
      const headZ = lz + outZ * 2.6;
      if (
        !isOnSidewalk(lx, lz, 0.55) ||
        blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
        blockAt(headX, headZ) ||
        !isClearOfPoles(lx, lz, 6.5)
      ) {
        continue;
      }
      placedPoles.push({ x: lx, z: lz });
      addFootprint(lx, lz, 0.45, 0.45);

      // Tall streetlight pole
      dummy.position.set(lx, 4.3, lz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.12, 8.4, 0.12);
      dummy.updateMatrix();
      poleMatrices.push(dummy.matrix.clone());

      // Upper luminaire bracket arm overhanging the street
      dummy.position.set(lx + outX * 1.15, 8.2, lz + outZ * 1.15);
      dummy.rotation.set(0, armYaw, 0);
      dummy.scale.set(2.3, 0.09, 0.09);
      dummy.updateMatrix();
      armMatrices.push(dummy.matrix.clone());

      // Cobra-head LED luminaire on the end of the arm, lens facing the street
      dummy.position.set(headX, 8.08, headZ);
      dummy.rotation.set(0, armYaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lampHeadMatrices.push(dummy.matrix.clone());
      dummy.rotation.set(0, 0, 0);

      cobraLampSites.push({
        x: headX,
        y: 8.02,
        z: headZ,
        tx: lx + outX * 3.4,
        tz: lz + outZ * 3.4
      });
    }

    // Post-top globe lanterns on the old-town sidewalks (with PointLights)
    if (b.district !== 'Stare Miasto' || len < 36) continue;
    const m = Math.max(2, Math.floor(len / GLOBE_SP));
    for (let j = 0; j < m; j++) {
      const f = (j + 0.5) / m;
      const cx = p0.x + dx * f;
      const cz = p0.z + dz * f;
      const px = cx + inx * 1.3;
      const pz = cz + inz * 1.3;
      if (
        !isOnSidewalk(px, pz, 0.55) ||
        blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
        !isClearOfPoles(px, pz, 5.2)
      ) {
        continue;
      }
      placedPoles.push({ x: px, z: pz });
      addFootprint(px, pz, 0.4, 0.4);

      dummy.position.set(px, 0.18, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pedPostMatrices.push(dummy.matrix.clone());
      streetPointSites.push({
        x: px,
        y: 4.02,
        z: pz,
        color: 0xffe0aa,
        intensity: 29,
        dist: 14.2
      });
    }
  }

  function addMatrixArrayInstanced(geo, mat, matrices, castShadow = true) {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    if (castShadow && !mat.isMeshBasicNodeMaterial && mat.type !== 'MeshBasicNodeMaterial' && !mat.transparent) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  addMatrixArrayInstanced(unitCyl, poleMetalMat, poleMatrices);
  addMatrixArrayInstanced(unitBox, poleMetalMat, armMatrices);
  addMatrixArrayInstanced(signalHousingGeo, signalHousingMat, yellowBoxMatrices);
  addMatrixArrayInstanced(signalLensGeo, aveSignalLensMat, aveLensMatrices, false);
  addMatrixArrayInstanced(signalLensGeo, streetSignalLensMat, streetLensMatrices, false);
  addMatrixArrayInstanced(unitBox, streetBladeMat, streetBladeMatrices);
  addMatrixArrayInstanced(walkHousingGeo, signalHousingMat, walkBoxMatrices);
  addMatrixArrayInstanced(walkPanelGeo, walkSignalGlow, walkBoxMatrices, false);
  addMatrixArrayInstanced(lampHousingGeo, poleMetalMat, lampHeadMatrices);
  addMatrixArrayInstanced(lampLensGeo, lampBulbGlow, lampHeadMatrices, false);
  addMatrixArrayInstanced(pedLampPostGeo, poleMetalMat, pedPostMatrices);
  addMatrixArrayInstanced(pedGlobeGeo, pedGlobeGlow, pedPostMatrices, false);

  // =========================================================================
  // 3. FIRE HYDRANTS ALONG CURBS (INSTANCED)
  //    One near the end of about every other curb edge, 0.8 m inside the curb
  // =========================================================================
  const hydrantPositions = [];
  for (const { p0, dx, dz, len, inx, inz } of curbEdges) {
    if (len < 30 || hashPos(p0.x, 5.3, p0.z) < 0.45) continue;
    const hx = p0.x + dx * 0.14 + inx * 0.8;
    const hz = p0.z + dz * 0.14 + inz * 0.8;
    if (isOnSidewalk(hx, hz, 0.45) && isClearOfPoles(hx, hz, 1.5)) hydrantPositions.push([hx, hz]);
  }

  const hydrantMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8241e, roughness: 0.5, metalness: 0.4 });
  const hydrantInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.85, 8), hydrantMat, hydrantPositions.length);
  hydrantPositions.forEach(([hx, hz], i) => {
    dummy.position.set(hx, 0.64, hz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydrantInst.setMatrixAt(i, dummy.matrix);
  });
  hydrantInst.instanceMatrix.needsUpdate = true;
  group.add(hydrantInst);

  // =========================================================================
  // 4. TREES: PARKS, SQUARES & PLAZAS, AND STREET TREES ALONG THE CURBS
  //    (one unified trunk + crown instanced mesh per species & band, js/trees.js)
  // =========================================================================
  const treePositions = []; // { x, y, z, scale, species (0 plane, 1 honey locust, 2 elm / oak) }
  const mixSpecies = (r, plane, locust) => (r < plane ? 0 : (r < plane + locust ? 1 : 2));

  // A. The parks, squares & plazas (sites laid out by city-grid.js, plus buildings.js's leftover slabs)
  for (const s of parkTreeSites || []) treePositions.push(s);

  // B. Street trees on the raised sidewalks of every real block, along each curb edge: small trees close to the curb
  //    on the narrow streets (a block across within ~14 m), planes, locusts & elms on the wider ones, with random
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
    // Cobra-head LED luminaire: wide downward spread (0.96 rad half-angle) illuminating both road and sidewalk
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

  const activeCobras = [];
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

    let cobraCount = 0;
    for (let i = 0; i < cobraLampSites.length; i++) {
      const s = cobraLampSites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const d2 = dx * dx + dz * dz + cy * cy;
      if (d2 > STREETLIGHT_DIST_SQ) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STREETLIGHT_DIST) continue;
      s._effDist = effDist;
      activeCobras[cobraCount++] = s;
    }
    activeCobras.length = cobraCount;
    if (cobraCount > 1) activeCobras.sort((a, b) => a._effDist - b._effDist);

    const cobraCutoff = cobraCount > STREETLIGHT_SPOT_POOL
      ? Math.min(STREETLIGHT_DIST, activeCobras[STREETLIGHT_SPOT_POOL]._effDist)
      : STREETLIGHT_DIST;
    const spotUsed = Math.min(cobraCount, STREETLIGHT_SPOT_POOL);
    for (let i = 0; i < spotUsed; i++) {
      const s = activeCobras[i];
      const fade = smoothFade(s._effDist, cobraCutoff * 0.62, cobraCutoff);
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
