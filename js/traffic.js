import * as THREE from 'three/webgpu';
import { buildRoadNetwork, CROSSWALK } from './road-network.js';
import { createPedestrianRoutes } from './pedestrian-routes.js';
import { updateSignal, requestWalkSignal, configurePedestrianSignal, configureSignalClearance, blockAt } from './city-config.js';
import { cityUniforms, createContactShadowMaterial } from './tsl-materials.js';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';
import {
  BODY_SPECS,
  BUS_SPEC,
  BUS_18_SPEC,
  carDimensions,
  polishRegistration,
  encodeRegistration,
  buildCarGeometry,
  buildCarProxyGeometry,
  buildSteerableWheelGeo,
  createLoftedCarMaterial,
  lightbarPlacement,
  buildLightbarGeometry,
  createLightbarMaterial,
  buildLoftedBusBodyGeometry,
  buildLoftedBus18FrontGeometry,
  buildLoftedBus18RearGeometry,
  buildBus18BellowsGeometry,
  buildBusSignGeometry,
  buildBus18SignGeometry,
  createBusSignMaterial,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial,
  createLoftedBus18FrontMaterial,
  createLoftedBus18RearMaterial,
  createBusBellowsMaterial
} from './actor-models.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { railClearance } from './city-grid.js';

// js/traffic.js
// City traffic and pedestrians on the road graph road-network.js derives from the city as built:
// - 200 cars (taxis, private cars and vans, Policja, PRM, PSP) and 12 MPK buses keep to their lanes and follow the vehicle
//   ahead (Intelligent Driver Model), change lanes to overtake or to reach a turn lane, turn into other streets,
//   stop for the signals street-details.js shows, give way to oncoming traffic when turning left, to the widest road at
//   unsignalized corners and to pedestrians on crosswalks, and never enter an intersection they can't clear.
// - 340 pedestrians follow connected sidewalks, meet to talk, and cross at the zebras: on WALK where signalised, with
//   priority over vehicles elsewhere.
// - Fixed-size local populations replenish distant roads and sidewalks in every direction, protecting the near view.
// - The player's vehicle or character pushes and is pushed by the traffic (SAT contact, impulses, sparks).
// - Trams (trams.js, set through setTrams): cars yield to them in the lanes and junctions they share, pedestrians wait
//   for them at the rails, and they push the player out of their way.

const NUM_CARS = 200;
const NUM_BUSES = 12;
const NUM_PEDS = 340;

// Intelligent Driver Model: max acceleration, comfortable braking, time headway, standstill gap; and the sideways
// acceleration drivers accept in bends, which sets how fast they take each turn or lane shift
const CAR_DRIVER = { a: 2.0, b: 3.0, T: 1.2, s0: 2.0, aLat: 3.5 };
const BUS_DRIVER = { a: 1.1, b: 2.5, T: 1.5, s0: 2.5, aLat: 2.0 };
const LOOKAHEAD = 70; // metres a driver looks ahead for vehicles, stop lines and signals
// m/s: the Polish built-up limit (50 km/h), for an edge without its own `limit` (road-network.js, from OSM maxspeed)
const URBAN_LIMIT = 50 / 3.6;

// Retire distant actors even when looking their way: keeping them indefinitely starves upcoming streets.
// Replacements may enter the far view, but nearby visible roads and sidewalks are protected from pop-in.
const VEHICLE_RADIUS = 380;
const PED_RADIUS = 320;
const NEAR_RADIUS = 350;
const PED_COURTESY = 5; // s a driver waits for people crossing at an unsignalised zebra before they let it go
// Vehicles per km of lane within NEAR_RADIUS (both ways counted: a two-way street with a lane each way is 2 km per
// km). The pool used to fill up regardless, so the sparse single-lane grids (Wilda, Łazarz, Jeżyce: 2.9-5 lane-km)
// carried 40-70 per lane-km, jam density, and 62% of cars stood still even without pedestrians or trams
// (tools/bench-traffic.mjs). MIN_VEHICLES keeps a few anywhere.
const VEHICLE_DENSITY = 12;
const MIN_VEHICLES = 30;
const VEHICLE_SPAWN_DISTANCE = 250;
const PED_SPAWN_DISTANCE = 150;

// Destination signs (ZTM Poznań-style line numbers; the destinations are plausible, not checked against timetables).
// Each bus keeps one for its life (busState.w).
const BUS_ROUTES = [
  ['174', 'RONDO KAPONIERA'],
  ['169', 'OS. SOBIESKIEGO'],
  ['164', 'GÓRCZYN'],
  ['151', 'RONDO RATAJE']
];

// Amber LED destination signs, one row per route: the line number in the first 29% of the width (the rear panel shows
// only that part) and the destination after it, then a dark grid over everything for the LED dot-matrix look
function createBusDestinationTexture() {
  const c = document.createElement('canvas');
  const rowH = 64;
  c.width = 512;
  c.height = rowH * BUS_ROUTES.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffa31a';
  ctx.textBaseline = 'middle';
  const fit = (text, x, y, maxWidth, align) => {
    const w = ctx.measureText(text).width;
    const k = w > maxWidth ? maxWidth / w : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, 1);
    ctx.textAlign = align;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  BUS_ROUTES.forEach(([line, destination], row) => {
    const y = row * rowH + rowH / 2 + 2;
    ctx.font = '800 46px Arial, sans-serif';
    fit(line, 74, y, 128, 'center');
    ctx.font = '700 34px Arial, sans-serif';
    fit(destination, 160, y, 340, 'left');
  });
  ctx.fillStyle = 'rgba(7, 8, 10, 0.75)';
  for (let x = 0; x < c.width; x += 4) ctx.fillRect(x, 0, 1, c.height);
  for (let y = 0; y < c.height; y += 4) ctx.fillRect(0, y, c.width, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function createTrafficSystem(scene, sidewalks, obstacles) {
  const group = new THREE.Group();
  group.name = 'TrafficAndPedestrians';
  let collisionListener = null;
  const collisionEvent = { a: null, b: null, kind: 'vehicle', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };

  function setCollisionListener(listener) {
    collisionListener = typeof listener === 'function' ? listener : null;
  }

  // Synchronous notification: listeners must copy any fields they retain. Normal points from b toward a.
  function reportCollision(a, b, x, y, z, nx, nz, speed) {
    if (!collisionListener || speed <= 0.5) return;
    collisionEvent.a = a; collisionEvent.b = b;
    collisionEvent.x = x; collisionEvent.y = y; collisionEvent.z = z;
    collisionEvent.nx = nx; collisionEvent.nz = nz; collisionEvent.speed = speed;
    collisionListener(collisionEvent);
  }

  const dummy = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI * 0.5);
  const contactShadowMat = createContactShadowMaterial();

  // =========================================================================
  // 0. ROAD NETWORK
  // =========================================================================
  const network = buildRoadNetwork(sidewalks, obstacles);
  const { nodes, edges, connector, curvePoint } = network;

  // Sides of an intersection (road-network.js step 7) are its arms, numbered from 0. Where lane i of edge e meets the
  // crosswalk of `arm` (e.inArm at e.to or e.outArm at e.from), measured along the crosswalk: along the lateral axis
  // of the arm's road, taken from its edge in, else out, as pedestrian-routes.js lays the crosswalk (x across
  // north-south roads, z across east-west ones). One axis per arm keeps the two roadways of a divided road, up to 20
  // degrees apart, on the walkers' scale.
  const laneCoord = (e, i, arm) => {
    const c = arm.in || arm.out, s = arm === e.inArm ? e.len : 0;
    return (e.sx + e.dx * s + e.rx * e.lanes[i]) * c.clx + (e.sz + e.dz * s + e.rz * e.lanes[i]) * c.clz;
  };

  for (const n of nodes) {
    n.box = new Array(n.groupCount).fill(0); // vehicles crossing it from each road (group 0: the widest)
    n.boxVehicles = []; // the holders, for geometric clearance where stop lines extend beyond the crossing roads
    n.crossing = new Array(n.sideCount).fill(0); // vehicles crossing (or about to cross) the crosswalk on each side
    n.approach = new Array(n.sideCount).fill(null); // the edge arriving over each side's crosswalk
    n.walkers = []; // pedestrians on its crosswalks
    n.curb = []; // pedestrians at the curbs of its crosswalks, standing or about to (who to queue behind)
  }
  for (const e of edges) {
    e.occ = e.lanes.map(() => []); // vehicles in each lane, sorted by position
    // e.inSide / e.outSide: the crosswalks crossed on the way into e.to / out of e.from; e.axisIndex: its group at e.to;
    // e.opposite: the oncoming edge of its road there (road-network.js)
    e.to.approach[e.inSide] = e;
    e.through = 0; // vehicles from e crossing e.to straight on or to the right
    e.lefts = 0; // and to the left
  }
  // Is the box held by other groups, or by an oncoming left turn across this particular movement?
  function boxBusy(n, g, v, leftOf = null) {
    let busy = leftOf ? leftOf.lefts > 0 : false;
    if (!leftOf) for (let k = 0; k < n.box.length; k++) if (k !== g && n.box[k] > 0) busy = true;
    if (!busy) return false;
    if (!v || !n.boxVehicles) return true;
    const c = connector(v.edge, v.lane, v.move.to, v.move.out[v.lane]);
    for (const holder of n.boxVehicles) {
      if (leftOf) {
        if (holder.edge !== leftOf || holder.move.turn !== 'L' || holder.yielding) continue;
      } else if (holder.edge.axisIndex === g) continue;
      if (!holder.conn || holder.yielding) return true;
      // A long connector can reach well past the other road. Keep its exit occupancy and zebra claims, but let
      // this approach pass once the holder's rear has cleared its entire swept path (Jeżyce car/tram wait cycle).
      // A rigid body cuts inside the curved centreline. The maximum-curvature sagitta bound also covers its
      // overhang beyond the axles; buses therefore keep more room on tight bends than a short car does.
      const width = v.halfWidth + holder.halfWidth
        + (c.curv || 0) * v.half * v.half / 2;
      const end = boxConflictEnd(c, holder.conn, width, holder.half);
      if (holder.cs - holder.half <= end) return true;
    }
    return false;
  }

  const boxSample = { x: 0, z: 0, dx: 0, dz: 0 };
  function boxSamples(c) {
    if (c.boxSamples) return c.boxSamples;
    const count = Math.max(1, Math.ceil(c.len / 0.25));
    const points = new Float64Array((count + 1) * 2);
    const bends = new Float64Array(count + 1);
    for (let k = 0; k <= count; k++) {
      const s = c.len * k / count;
      curvePoint(c, s, boxSample);
      points[k * 2] = boxSample.x;
      points[k * 2 + 1] = boxSample.z;
      let h = 1;
      while (h < 16 && c.lut[h] < s) h++;
      const t = (h - 1 + Math.min(1, Math.max(0, (s - c.lut[h - 1]) / (c.lut[h] - c.lut[h - 1] || 1)))) / 16;
      const u = 1 - t;
      const dx = 3 * u * u * (c.x1 - c.x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (c.x3 - c.x2);
      const dz = 3 * u * u * (c.z1 - c.z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (c.z3 - c.z2);
      const ddx = 6 * u * (c.x2 - 2 * c.x1 + c.x0) + 6 * t * (c.x3 - 2 * c.x2 + c.x1);
      const ddz = 6 * u * (c.z2 - 2 * c.z1 + c.z0) + 6 * t * (c.z3 - 2 * c.z2 + c.z1);
      bends[k] = Math.abs(dx * ddz - dz * ddx) / Math.max(1e-6, Math.hypot(dx, dz) ** 3);
    }
    c.boxSamples = points;
    c.boxBends = bends;
    return points;
  }

  // Last position along b that can conflict with a. Sampling at 0.25 m adds at most 0.25 m to the distance
  // between the nearest pair of samples; the 0.3 m margin covers it. Curves and width pairs are cached once.
  function boxConflictEnd(a, b, width, half = 0) {
    if (!b.boxConflicts) b.boxConflicts = new Map();
    let cache = b.boxConflicts.get(a);
    if (!cache) b.boxConflicts.set(a, (cache = new Map()));
    let lengths = cache.get(width);
    if (!lengths) cache.set(width, (lengths = new Map()));
    if (lengths.has(half)) return lengths.get(half);
    const A = boxSamples(a), B = boxSamples(b);
    const steps = Math.ceil(2 * half / (b.len / (b.boxBends.length - 1))) + 1;
    let end = -Infinity;
    for (let j = B.length - 2; j >= 0 && end === -Infinity; j -= 2) {
      // Any rigid body covering this point spans at most two half-lengths either side of it. Curvature behind
      // that interval no longer matters: a completed tight turn must not inflate the straight exit forever.
      let bend = 0;
      for (let k = Math.max(0, j / 2 - steps); k <= Math.min(b.boxBends.length - 1, j / 2 + steps); k++) {
        bend = Math.max(bend, b.boxBends[k]);
      }
      const reach2 = (width + 0.3 + bend * half * half / 2) ** 2;
      for (let i = 0; i < A.length; i += 2) {
        if ((A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2 > reach2) continue;
        end = Math.min(b.len, b.len * j / (B.length - 2) + 0.25);
        break;
      }
    }
    lengths.set(half, end);
    return end;
  }

  // =========================================================================
  // 1. 3D LOFTED CARS, TAXIS, VANS & EMERGENCY VEHICLES (200 VEHICLES)
  // =========================================================================
  // pace: the driver's desired speed as a share of the posted limit; vmax: the most it drives at anywhere
  function createVehicle(bus, half, halfWidth, axle, driver, pace, vmax) {
    return {
      bus, half, halfWidth, axle, driver, pace, vmax, v0: Math.min(vmax, pace * URBAN_LIMIT),
      edge: null, lane: 0, s: 0, speed: 0, acc: 0, gap: Infinity, leaderSpeed: 0,
      move: null, out: 0, conn: null, cs: 0, trail: null, commit: null, claimed: false, yielding: false, yieldAt: 0,
      wait: 0, pedWait: 0, mergeArrival: Infinity, waitReason: '', held: '', leader: null, laneTimer: Math.random() * 0.5,
      dl: 0, dlv: 0, blink: 0, blinkPhase: Math.random() * 0.8,
      x: 0, z: 0, prevX: 0, prevZ: 0, tx: 0, tz: 1, nose: 0, yaw: 0, yawRate: 0, steer: 0,
      pitch: 0, roll: 0, pitchVel: 0, rollVel: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0,
      pAhead: Infinity, pRight: 0, pSpeed: 0, wheelSpin: Math.random() * Math.PI * 2
    };
  }

  // The five lofted body classes common on Polish streets (BODY_SPECS in actor-models.js: the Corolla-class taxi
  // saloon, hatchback, estate, crossover and panel van), with one shared set of separately instanced spinning wheels
  // scaled to each body's wheel radius
  const CAR_KINDS = ['taxi', 'hatch', 'estate', 'crossover', 'van', 'fireTruck'];
  const WHEEL_SPEC = BODY_SPECS.hatch;
  const carWheelLeftGeo = buildSteerableWheelGeo(WHEEL_SPEC, -1);
  const carWheelRightGeo = buildSteerableWheelGeo(WHEEL_SPEC, 1);
  const carWheelMat = createLoftedCarMaterial(WHEEL_SPEC, 0x8a9096); // neutral steel hub grey

  // Private cars and taxis (Polish taxis come in any colour, no yellow cabs): mostly greys, whites, blacks and silvers,
  // some blue and red, as on Polish roads; delivery vans are mostly white. Repeats weight the pick.
  const carPalette = [
    new THREE.Color(0xeceff1), // White
    new THREE.Color(0xf4f4f0), // Pure white
    new THREE.Color(0x16181c), // Black
    new THREE.Color(0x202328), // Black metallic
    new THREE.Color(0x4a4f56), // Graphite grey
    new THREE.Color(0x4a4f56),
    new THREE.Color(0x7b8189), // Moon grey
    new THREE.Color(0x7b8189),
    new THREE.Color(0xc3c9cf), // Silver
    new THREE.Color(0xa9b0b7), // Dark silver
    new THREE.Color(0x1f3558), // Navy
    new THREE.Color(0x2c5aa0), // Blue
    new THREE.Color(0x9e1b22), // Red
    new THREE.Color(0x5c1a20), // Burgundy
    new THREE.Color(0x2b3d33), // Dark green
    new THREE.Color(0x8a7660)  // Brown-beige
  ];
  const vanPalette = [
    new THREE.Color(0xeceff1),
    new THREE.Color(0xf4f4f0),
    new THREE.Color(0xeceff1),
    new THREE.Color(0xc3c9cf),
    new THREE.Color(0x7b8189),
    new THREE.Color(0x1f3558)
  ];
  // Emergency liveries (carState.w, painted by createLoftedCarMaterial): 1 Policja (silver-white with the blue band) on
  // the estate, 2 PRM ambulance (yellow) and 3 PSP light rescue van (red) on the van
  const LIVERY_PAINT = [null, new THREE.Color(0xe6e9ec), new THREE.Color(0xf0dc2a), new THREE.Color(0xb3121b)];
  // Golden-ratio pick: the mix rules below tie each body type to fixed index residues, which `i % length` would map
  // onto only part of a palette
  const pick = (palette, i) => palette[Math.floor(((i * 0.6180339887) % 1) * palette.length)];
  // Shares of the private cars (all but taxis and emergency vehicles), picked by a second low-discrepancy sequence of
  // the index (the plastic number, so it does not follow the paint pick)
  const PRIVATE_MIX = [['hatch', 0.38], ['estate', 0.24], ['crossover', 0.28], ['van', 0.1]];

  const cars = [];
  const bodyCounts = { taxi: 0, hatch: 0, estate: 0, crossover: 0, van: 0, fireTruck: 0 };
  const barCounts = { estate: 0, van: 0, fireTruck: 0 };

  for (let i = 0; i < NUM_CARS; i++) {
    // 5 Policja, 4 ambulances, 2 fire service trucks; the livery wins over the taxi rule (index 168)
    const livery = (i % 40) === 6 ? 1 : (i % 50) === 18 ? 2 : (i % 100) === 42 ? 3 : 0;
    // Every emergency vehicle uses its siren and the police signal privileges (isPolice: traffic.js signal logic,
    // audio-sources.js siren)
    const isPolice = livery > 0;
    const isTaxi = !isPolice && (i % 8) === 0;

    let bodyType;
    if (livery === 1) bodyType = 'estate';
    else if (livery === 2) bodyType = 'van';
    else if (livery === 3) bodyType = 'fireTruck';
    else if (isTaxi) bodyType = 'taxi';
    else {
      let u = (i * 0.7548776662 + 0.31) % 1;
      for (const [kind, share] of PRIVATE_MIX) {
        bodyType = kind;
        if ((u -= share) < 0) break;
      }
    }
    bodyCounts[bodyType]++;
    if (livery) barCounts[bodyType]++;
    const col = livery ? LIVERY_PAINT[livery] : pick(bodyType === 'van' || bodyType === 'fireTruck' ? vanPalette : carPalette, i);
    // isSUV: the bigger engine sound (audio-sources.js) and the heavier push against the player
    const isSUV = bodyType === 'crossover' || bodyType === 'van' || bodyType === 'fireTruck';

    const spec = BODY_SPECS[bodyType];
    const dims = carDimensions(spec);
    const pace = 0.9 + (i % 5) * 0.05;
    const car = createVehicle(false, dims.half, dims.halfWidth - 0.03, dims.axle, CAR_DRIVER, pace, 80 / 3.6);
    // paint and plate as float32 values, so renderCar() can tell whether a slot's attributes change by comparing
    const paint = [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)];
    const plate = encodeRegistration(polishRegistration(i + 1));
    const bar = lightbarPlacement(spec);
    Object.assign(car, {
      isTaxi, isPolice, isSUV, livery, bodyType, paint, plate,
      hitW: dims.halfWidth - 0.03, hitL: dims.half - 0.07, // player collision box (collideWithPlayer)
      shadowW: dims.halfWidth * 2 + 0.36, shadowL: dims.half * 2 + 0.55, // contact shadow
      barY: bar.y + 0.4, barZ: bar.z // where the light bar's blue point light flashes
    });
    cars.push(car);
  }

  // Per body type: the full model (with separately instanced spinning wheels near the camera) and, beyond
  // CAR_PROXY_DISTANCE, the ~500-triangle stand-in. Instance slots are handed out every frame to the cars the camera
  // can see (or whose shadow it may see), see renderCar(). Per-instance paint, registration (plateCode) & lamp / livery
  // state the car material reads: brake lights, left (+x) & right (-x) turn signals, livery (car.livery: 1 Policja,
  // 2 ambulance, 3 fire).
  const bodies = {};
  for (const kind of CAR_KINDS) {
    const spec = BODY_SPECS[kind];
    const mat = createLoftedCarMaterial(spec);
    const n = Math.max(1, bodyCounts[kind]);
    const lodMesh = (g) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      g.setAttribute('plateCode', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      return new THREE.InstancedMesh(g, mat, n);
    };
    bodies[kind] = { near: lodMesh(buildCarGeometry(spec, false)), far: lodMesh(buildCarProxyGeometry(spec)) };
  }
  const bodyMeshes = Object.values(bodies).flatMap((b) => [b.near, b.far]);

  const carWheelLeftInst = new THREE.InstancedMesh(carWheelLeftGeo, carWheelMat, NUM_CARS * 2);
  const carWheelRightInst = new THREE.InstancedMesh(carWheelRightGeo, carWheelMat, NUM_CARS * 2);

  // 3D Collision Spark & Debris Particle Pool
  const MAX_SPARKS = 120;
  const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.26);
  const sparkMat = new THREE.MeshBasicNodeMaterial({ color: 0xffc438 });
  const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
  const sparks = [];
  let sparkCursor = 0;
  for (let s = 0; s < MAX_SPARKS; s++) {
    sparks.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.4 });
  }
  function spawnCollisionSparks(x, y, z, nx, nz, impactSpeed) {
    const count = Math.min(24, Math.max(8, Math.floor(impactSpeed * 1.4)));
    const tx = -nz;
    const tz = nx;
    for (let k = 0; k < count; k++) {
      const sp = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const spread = (Math.random() - 0.5) * 2.2;
      const outBoost = (0.3 + Math.random() * 0.9) * Math.min(14.0, impactSpeed * 0.65);
      const tanBoost = spread * Math.min(12.0, impactSpeed * 0.55);
      sp.x = x + (Math.random() - 0.5) * 0.35;
      sp.y = y + (Math.random() - 0.5) * 0.18;
      sp.z = z + (Math.random() - 0.5) * 0.35;
      sp.vx = nx * outBoost + tx * tanBoost;
      sp.vy = 2.4 + Math.random() * 5.4;
      sp.vz = nz * outBoost + tz * tanBoost;
      sp.maxLife = 0.28 + Math.random() * 0.24;
      sp.life = sp.maxLife;
    }
  }

  // Blue emergency roof light bars, one mesh per body that carries them (the estate's Policja, the van's PRM and PSP;
  // the liveries are painted by the body materials from the instance's carState). `drawn` counts the slots per frame.
  const lightbars = {};
  for (const kind of Object.keys(barCounts)) {
    const inst = new THREE.InstancedMesh(buildLightbarGeometry(BODY_SPECS[kind]), createLightbarMaterial(), Math.max(1, barCounts[kind]));
    inst.castShadow = true;
    lightbars[kind] = { inst, drawn: 0 };
  }
  const lightbarList = Object.values(lightbars);
  const lightbarMeshes = lightbarList.map((b) => b.inst);
  const carShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_CARS);
  carShadowInst.renderOrder = 998;

  for (const m of bodyMeshes) m.castShadow = m.receiveShadow = true;
  carWheelLeftInst.castShadow = carWheelLeftInst.receiveShadow = true;
  carWheelRightInst.castShadow = carWheelRightInst.receiveShadow = true;

  group.add(
    ...bodyMeshes,
    carWheelLeftInst,
    carWheelRightInst,
    sparkInst,
    ...lightbarMeshes
  );

  // =========================================================================
  // 2. LOFTED MPK POZNAŃ CITY BUSES (12 BUSES)
  // =========================================================================
  // 2a. Rigid 12 m City Buses (Solaris Urbino 12)
  const busBodyGeo = buildLoftedBusBodyGeometry();
  const busStates = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES * 4), 4);
  busBodyGeo.setAttribute('busState', busStates);
  const busHeaderGeo = buildBusSignGeometry();
  busHeaderGeo.setAttribute('busState', busStates);

  const busBodyMat = createLoftedBusMaterial();
  const busDestMat = createBusSignMaterial(createBusDestinationTexture(), BUS_ROUTES.length);
  const busWheelMat = createBusWheelMaterial();

  const busBodyInst = new THREE.InstancedMesh(busBodyGeo, busBodyMat, NUM_BUSES);
  const busHeaderInst = new THREE.InstancedMesh(busHeaderGeo, busDestMat, NUM_BUSES);
  const busWheelLeftInst = new THREE.InstancedMesh(buildBusWheelGeo(-1), busWheelMat, NUM_BUSES * 2);
  const busWheelRightInst = new THREE.InstancedMesh(buildBusWheelGeo(1), busWheelMat, NUM_BUSES * 2);
  const busShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_BUSES);
  busShadowInst.renderOrder = 998;

  busBodyInst.castShadow = busBodyInst.receiveShadow = true;
  busWheelLeftInst.castShadow = busWheelLeftInst.receiveShadow = true;
  busWheelRightInst.castShadow = busWheelRightInst.receiveShadow = true;

  // 2b. Articulated 18 m City Buses (Solaris Urbino 18)
  const bus18FrontGeo = buildLoftedBus18FrontGeometry();
  const bus18States = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES * 4), 4);
  bus18FrontGeo.setAttribute('busState', bus18States);
  const bus18RearGeo = buildLoftedBus18RearGeometry();
  bus18RearGeo.setAttribute('busState', bus18States);
  const bus18BellowsGeo = buildBus18BellowsGeometry();
  const bus18SignGeo = buildBus18SignGeometry();
  bus18SignGeo.setAttribute('busState', bus18States);

  const bus18FrontMat = createLoftedBus18FrontMaterial();
  const bus18RearMat = createLoftedBus18RearMaterial();
  const bus18BellowsMat = createBusBellowsMaterial();

  const bus18FrontInst = new THREE.InstancedMesh(bus18FrontGeo, bus18FrontMat, NUM_BUSES);
  const bus18RearInst = new THREE.InstancedMesh(bus18RearGeo, bus18RearMat, NUM_BUSES);
  const bus18BellowsInst = new THREE.InstancedMesh(bus18BellowsGeo, bus18BellowsMat, NUM_BUSES);
  const bus18SignInst = new THREE.InstancedMesh(bus18SignGeo, busDestMat, NUM_BUSES);
  const bus18WheelLeftInst = new THREE.InstancedMesh(buildBusWheelGeo(-1), busWheelMat, NUM_BUSES * 3);
  const bus18WheelRightInst = new THREE.InstancedMesh(buildBusWheelGeo(1), busWheelMat, NUM_BUSES * 3);
  const bus18ShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_BUSES * 2);
  bus18ShadowInst.renderOrder = 998;

  bus18FrontInst.castShadow = bus18FrontInst.receiveShadow = true;
  bus18RearInst.castShadow = bus18RearInst.receiveShadow = true;
  bus18BellowsInst.castShadow = bus18BellowsInst.receiveShadow = true;
  bus18WheelLeftInst.castShadow = bus18WheelLeftInst.receiveShadow = true;
  bus18WheelRightInst.castShadow = bus18WheelRightInst.receiveShadow = true;

  const buses = [];
  for (let i = 0; i < NUM_BUSES; i++) {
    const route = i % BUS_ROUTES.length;
    const articulated = (route % 4) !== 2; // lines 174, 169, 151 are articulated Urbino 18; 164 is Urbino 12
    const halfL = articulated ? 9.0 : BUS_SPEC.zFront;
    const axleZ = articulated ? 3.8 : BUS_SPEC.wheelZ;
    buses.push(Object.assign(
      createVehicle(true, halfL, 1.3, axleZ, BUS_DRIVER, 0.7 + (i % 3) * 0.05, 50 / 3.6),
      { route, articulated, trailer: null }
    ));
  }
  const vehicles = [...cars, ...buses];
  group.add(
    busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst,
    bus18FrontInst, bus18RearInst, bus18BellowsInst, bus18SignInst, bus18WheelLeftInst, bus18WheelRightInst
  );

  // =========================================================================
  // 3. SKINNED, PROCEDURALLY ANIMATED SIDEWALK PEDESTRIANS (340 PEDESTRIANS, see pedestrians.js)
  // =========================================================================
  // One instanced draw per level of detail; every pedestrian has a PersonRig that plants its footsteps on the
  // sidewalk (no sliding), with their own build, height, sex, hair, clothes and gait
  const pedCrowd = new PersonCrowd(NUM_PEDS);
  const hash = (i, salt) => {
    const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const peds = [];
  for (let i = 0; i < NUM_PEDS; i++) {
    const female = hash(i, 1) < 0.48;
    const hairRoll = hash(i, 2);
    peds.push({
      placed: false,
      crossesStreets: i % 6 === 0, // some start near crossings; everyone can use them along their route
      x: 0,
      z: 0,
      ax: 0, // track: start, direction, length; position along it and walking direction
      az: 0,
      ux: 0,
      uz: 1,
      len: 1,
      t: 0,
      dir: 1,
      node: null, // the intersection of its crosswalk, which side of it, where along it
      side: 0,
      group: 0, // the right-of-way group of the road it crosses there, whose phase holds the WALK
      coord: 0,
      line: 0, // its line over the crosswalk, off the centre line
      waiting: false,
      through: false, // crossing on from a split crossing's strip with no room to wait (no stop at the next curb)
      speed: 1.22 + (i % 5) * 0.1 + hash(i, 3) * 0.08, // preferred walking speed
      v: 0, // current speed, easing up to it and down to stops
      pause: 0,
      route: null,
      nextRoute: null,
      nextLeg: 0,
      goalX: 0,
      goalZ: 0,
      goalTime: 0,
      restTime: 0,
      socialTime: 0,
      conversation: null,
      rig: new PersonRig({
        seed: i * 1.6180339 + 0.13,
        female,
        scale: (female ? 0.91 : 0.97) + hash(i, 4) * 0.1,
        girth: 0.9 + hash(i, 5) * 0.24,
        hair: female ? (hairRoll < 0.68 ? 1 : 0.3 + hairRoll * 0.25) : hairRoll < 0.08 ? 1 : hairRoll * 0.35,
        armSwing: 0.75 + hash(i, 6) * 0.5,
        stride: 0.94 + hash(i, 7) * 0.12
      })
    });
  }
  group.add(...pedCrowd.meshes);

  // Add vehicle contact shadows last + pre-allocated Clustered SpotLight / PointLight pools
  group.add(carShadowInst, busShadowInst);

  const HEADLIGHT_POOL_SIZE = 96;
  const POLICE_LIGHT_POOL_SIZE = 6;
  const MAX_LIGHT_DIST = 115;
  const MAX_LIGHT_DIST_SQ = MAX_LIGHT_DIST * MAX_LIGHT_DIST;
  const DUAL_BEAM_DIST_SQ = 96 * 96;
  const DUAL_BEAM_MAX_VEHICLES = 44;

  const trafficLightsGroup = new THREE.Group();
  trafficLightsGroup.name = 'TrafficClusteredLights';
  group.add(trafficLightsGroup);

  const headlightPool = [];
  for (let i = 0; i < HEADLIGHT_POOL_SIZE; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    trafficLightsGroup.add(spot, spot.target);
    headlightPool.push(spot);
  }

  const policeLightPool = [];
  for (let i = 0; i < POLICE_LIGHT_POOL_SIZE; i++) {
    const pt = new THREE.PointLight(0x1868ff, 0, 12.0, 1.25);
    pt.position.set(0, -1000, 0);
    trafficLightsGroup.add(pt);
    policeLightPool.push(pt);
  }

  // Nothing shows until it has been placed
  const carInstances = [...bodyMeshes, carWheelLeftInst, carWheelRightInst, ...lightbarMeshes, carShadowInst];
  const busInstances = [
    busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst,
    bus18FrontInst, bus18RearInst, bus18BellowsInst, bus18SignInst, bus18WheelLeftInst, bus18WheelRightInst, bus18ShadowInst
  ];
  for (const inst of [...carInstances, ...busInstances, sparkInst]) {
    inst.frustumCulled = false;
    for (let i = 0; i < inst.count; i++) inst.setMatrixAt(i, zero);
  }

  scene.add(group);

  // =========================================================================
  // 4. WHO IS WHERE: LANE OCCUPANCY, INTERSECTIONS, VIEW, PLAYER
  // =========================================================================
  let clock = 0;
  // Refresh each junction once, before driving. Vehicles and walkers read the same cached timing as the heads,
  // trams and crossing audio; adding vehicles does not add phase calculations.
  const signalNodes = [];
  const phaseOf = (e) => (e.axisIndex === 0 ? e.to.signalTiming.phase0 : e.to.signalTiming.phase1);
  function updateSignals(time) {
    for (const n of signalNodes) updateSignal(time, n);
  }
  let focusX = 0;
  let focusZ = 140;
  const player = { active: false, entity: null, x: 0, z: 0, vx: 0, vz: 0, halfW: 0.86, halfL: 2.23, push: 0.5 };

  // Lane lists hold pooled { v, s } entries sorted by position s along the lane, rebuilt every frame
  const pool = [];
  let poolUsed = 0;
  const filled = [];
  function occupy(list, v, s) {
    let o = pool[poolUsed++];
    if (!o) pool.push((o = { v: null, s: 0 }));
    o.v = v;
    o.s = s;
    if (!list.length) filled.push(list);
    list.push(o);
    for (let k = list.length - 1; k > 0 && list[k - 1].s > s; k--) {
      list[k] = list[k - 1];
      list[k - 1] = o;
    }
  }

  // Half way through a lane change a vehicle still occupies the lane it is leaving (-1 left, 1 right)
  function straddle(v) {
    if (v.conn) return 0;
    if (v.dl > 0.5 && v.lane + 1 < v.edge.lanes.length) return 1;
    if (v.dl < -0.5 && v.lane > 0) return -1;
    return 0;
  }

  // A vehicle crossing an intersection, or committed to crossing it, holds it against crossing traffic and
  // pedestrians on the crosswalks it passes, and its place in the lane it heads for. The counters it raises are reset
  // next frame for just the nodes and edges touched (a few hundred out of thousands)
  const touchedNodes = [];
  const touchedEdges = [];
  const touchNode = (n) => {
    if (!n.touched) {
      n.touched = true;
      touchedNodes.push(n);
    }
    return n;
  };
  const touchEdge = (e) => {
    if (!e.touched) {
      e.touched = true;
      touchedEdges.push(e);
    }
    return e;
  };
  function claim(v) {
    if (v.claimed) return;
    v.claimed = true;
    const e = v.edge;
    const f = v.move.to;
    touchNode(e.to).box[e.axisIndex]++;
    e.to.boxVehicles.push(v);
    // A shared zebra can meet the incoming arm deeper inside the box than its normal crosswalk band.
    if (!v.conn || v.cs < v.half + (v.conn.crosswalkEnd ?? e.setbackTo + CROSSWALK)) e.to.crossing[e.inSide]++;
    if (v.move.turn !== 'L') touchEdge(e).through++;
    if (!v.yielding) cross(v);
    occupy(f.occ[v.out], v, v.conn ? v.cs - v.conn.len : v.s - e.len - connector(e, v.lane, f, v.out).len);
  }

  // ...and, unless still waiting inside to turn left, the oncoming lanes and the crosswalk on its way out
  function cross(v) {
    const e = v.edge;
    if (v.move.turn === 'L') touchEdge(e).lefts++;
    touchNode(e.to).crossing[v.move.to.outSide]++;
    v.yielding = false;
  }

  // At an unsignalised zebra people have the right of way, and they stepped off whenever the car at the line could
  // stop, which it always can: with a few people arriving a minute, a car waited for a gap that never came (the head
  // of 20-35% of the stopped cars in Jeżyce, Wilda and at Kaponiera; up to 260 s). A driver held up for them
  // PED_COURTESY seconds gets its turn: it counts as crossing the crosswalks it passes, so whoever is still at the curb
  // waits (mayCross) while those already on the zebra clear it. The car behind starts its own count at the line.
  function courtesy(v) {
    const n = v.edge.to;
    if (n.signal) return;
    touchNode(n);
    if (!v.conn) n.crossing[v.edge.inSide]++;
    n.crossing[v.move.to.outSide]++;
  }

  function buildOccupancy() {
    for (const list of filled) list.length = 0;
    filled.length = 0;
    poolUsed = 0;
    for (const n of touchedNodes) {
      n.box.fill(0);
      n.boxVehicles.length = 0;
      n.crossing.fill(0);
      n.touched = false;
    }
    touchedNodes.length = 0;
    for (const e of touchedEdges) {
      e.through = e.lefts = 0;
      e.touched = false;
    }
    touchedEdges.length = 0;
    for (const v of vehicles) v.claimed = false;
    for (const v of vehicles) {
      const e = v.edge;
      if (!e) continue;
      // A short outgoing edge can end before a long vehicle's tail clears the previous crossing. Retain the
      // reservation even when the centre has entered the following connector.
      if (e.crosswalkTails) {
        const s = v.conn ? e.len + v.cs : v.s;
        for (const tail of e.crosswalkTails) {
          if (s < v.half + tail.end) touchNode(tail.node).crossing[tail.side]++;
        }
      }
      if (!v.conn) {
        occupy(e.occ[v.lane], v, v.s);
        const side = straddle(v);
        if (side) occupy(e.occ[v.lane + side], v, v.s);
        if (v.commit === e.to) claim(v);
        if (v.s < v.half - e.setbackFrom) touchNode(e.from).crossing[e.outSide]++; // its tail still over the crosswalk behind it
        if (v.waitReason === 'pedestrian' && v.pedWait > PED_COURTESY) courtesy(v);
      } else {
        claim(v);
        if (v.waitReason === 'pedestrian' && v.pedWait > PED_COURTESY) courtesy(v);
        occupy(e.occ[v.lane], v, e.len + v.cs); // until it is out of the intersection, still ahead of those behind it
      }
    }
    tramFrame++;
    occupyTrams();
  }

  // The camera's view, for drawing and protecting nearby spawn locations
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  let hasView = false;
  let camX = 0;
  let camY = 10;
  let camZ = 140;
  let camFwdX = 0;
  let camFwdZ = 1;
  function updateView(camera) {
    hasView = !!camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    camX = camera.position.x;
    camY = camera.position.y;
    camZ = camera.position.z;
    const me = camera.matrixWorld.elements;
    camFwdX = -me[8];
    camFwdZ = -me[10];
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
  }
  // Could the camera see a sphere of radius r around ground point (x, z)? Side planes only: the near and far
  // planes depend on depth conventions, and the side planes alone already rule out everything behind the camera.
  function visible(x, z, r) {
    if (!hasView) return false;
    for (let k = 0; k < 4; k++) {
      const { normal, constant } = frustum.planes[k];
      if (normal.x * x + normal.y + normal.z * z + constant < -r) return false;
    }
    return true;
  }

  function nearView(x, z, radius, distance) {
    return hasView && Math.hypot(x - camX, camY, z - camZ) < distance && visible(x, z, radius);
  }

  // Edges and the junctions with crosswalks (crossingNodes, signalised or not) around the focus, to place vehicles and
  // pedestrians on
  const nearEdges = [];
  const nearCrossings = [];
  let nearLanes = 0; // metres of lane within NEAR_RADIUS of the focus
  let nearTarget = 0; // how many vehicles drive there (VEHICLE_DENSITY)
  let nearBusTarget = 0; // reserve the pool's bus share so cars cannot consume every local slot
  let nearX = Infinity;
  let nearZ = Infinity;
  function refreshNear() {
    if (Math.hypot(focusX - nearX, focusZ - nearZ) < 40) return;
    nearX = focusX;
    nearZ = focusZ;
    nearEdges.length = 0;
    nearCrossings.length = 0;
    nearLanes = 0;
    for (const e of edges) {
      const along = (focusX - e.sx) * e.dx + (focusZ - e.sz) * e.dz;
      const s = clamp(along, 0, e.len);
      const dx = e.sx + e.dx * s - focusX, dz = e.sz + e.dz * s - focusZ;
      if (dx * dx + dz * dz >= NEAR_RADIUS * NEAR_RADIUS) continue;
      nearEdges.push(e);
      // the length of its lanes inside the circle
      const off = (focusX - e.sx) * e.dz - (focusZ - e.sz) * e.dx;
      const half = Math.sqrt(Math.max(0, NEAR_RADIUS * NEAR_RADIUS - off * off));
      nearLanes += Math.max(0, Math.min(e.len, along + half) - Math.max(0, along - half)) * e.lanes.length;
    }
    nearTarget = Math.min(vehicles.length, Math.max(MIN_VEHICLES, Math.round((nearLanes / 1000) * VEHICLE_DENSITY)));
    nearBusTarget = nearEdges.some((e) => e.major && e.len >= 2 * buses[0].half + 10)
      ? Math.ceil(nearTarget * buses.length / vehicles.length) : 0;
    for (const n of crossingNodes) {
      const dx = n.x - focusX, dz = n.z - focusZ;
      if (dx * dx + dz * dz < NEAR_RADIUS * NEAR_RADIUS) nearCrossings.push(n);
    }
  }

  // Where the player is relative to v: metres ahead, metres to the right, and how fast it moves v's way
  function relateToPlayer(v) {
    v.pAhead = Infinity;
    if (!player.active) return;
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    if (Math.abs(dx) > LOOKAHEAD + 10 || Math.abs(dz) > LOOKAHEAD + 10) return;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    v.pAhead = dx * fx + dz * fz;
    v.pRight = dz * fx - dx * fz;
    v.pSpeed = Math.max(0, player.vx * fx + player.vz * fz);
  }

  // Gap to the player if it is ahead in the lane whose centre is `off` metres to the right of v
  function playerGap(v, off) {
    if (v.pAhead < 0 || v.pAhead > LOOKAHEAD) return Infinity;
    if (Math.abs(v.pRight - off) > v.halfWidth + player.halfW + 0.4) return Infinity;
    return v.pAhead - v.half - player.halfL;
  }

  // =========================================================================
  // 5. DRIVING
  // =========================================================================
  // The lane nearest to `lane` that move m can be made from (m.out[i] is the lane lane i leads to, or -1)
  function nearestLane(m, lane) {
    let best = -1;
    for (let i = 0; i < m.out.length; i++) {
      if (m.out[i] >= 0 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
    }
    return best;
  }

  // First vehicle ahead of position s in a lane list
  function ahead(list, s, v) {
    for (const o of list) if (o.s > s && o.v !== v) return o;
    return null;
  }

  // The front-most vehicle still approaching the end of a lane: not crossing at its end yet, though maybe still coming
  // out of the intersection at its start (at s < 0)
  function leadOf(list) {
    for (let k = list.length - 1; k >= 0; k--) if (!list[k].v.conn || list[k].s < 0) return list[k];
    return null;
  }

  // Intelligent Driver Model: acceleration on a free road, and the braking term for an obstacle `gap` metres
  // (bumper to bumper) ahead moving at `speed`
  const freeAcc = (v) => v.driver.a * (1 - (v.speed / v.v0) ** 4);
  // Desired speed v0 on edge e: the driver's pace times the posted limit (cars 0.9-1.1, so 45-55 km/h in a 50 zone and
  // 27-33 in a 30 zone; buses 0.7-0.8), never above the vehicle's own top speed
  const desiredOn = (v, e) => Math.min(v.vmax, v.pace * (e.limit || URBAN_LIMIT));
  function brake(v, gap, speed, s0 = v.driver.s0, T = v.driver.T) {
    const { a, b } = v.driver;
    const desired = s0 + Math.max(0, v.speed * T + (v.speed * (v.speed - speed)) / (2 * Math.sqrt(a * b)));
    return -a * (desired / Math.max(gap, 0.1)) ** 2;
  }
  // ...and for a line d metres ahead to stop s0 short of: no time gap to keep to a line
  const stopAt = (v, d, s0 = 1) => brake(v, d, 0, s0, 0);

  // Does u (a vehicle ahead in list) not obstruct v because it is turning left out of the path,
  // or v is passing it on the right on a wide single-lane approach?
  function clearsTurn(v, u) {
    if (!v.move || v.move.turn === 'L' || !u.move || u.move.turn !== 'L') return false;
    if (u.conn) {
      if (!u.yielding) return false;
      const vc = v.conn || (v.move.to && v.move.out[v.lane] >= 0 ? connector(v.edge, v.lane, v.move.to, v.move.out[v.lane]) : null);
      if (!vc || typeof boxConflictEnd !== 'function') return false;
      return u.cs - u.half > boxConflictEnd(vc, u.conn, v.halfWidth + u.halfWidth, u.half);
    }
    if (v.edge && (!v.edge.lanes || v.edge.lanes.length === 1) && u.speed < 1.5) {
      return (v.dl - u.dl) >= v.halfWidth + u.halfWidth + 0.05;
    }
    return false;
  }

  // Braking for the vehicle ahead of position s in a lane list; remembers the nearest one
  function follow(v, list, s) {
    const o = ahead(list, s, v);
    if (!o || clearsTurn(v, o.v)) return 0;
    const gap = o.s - o.v.half - s - v.half;
    if (gap > LOOKAHEAD) return 0;
    if (gap < v.gap) {
      v.gap = gap;
      v.leaderSpeed = o.v.speed;
      v.leader = o.v;
    }
    return brake(v, gap, o.v.speed);
  }

  // Can v, d metres before a line, still stop at it braking no harder than its driver comfortably does?
  const canStopBefore = (v, d) => freeAcc(v) + stopAt(v, d) > -v.driver.b;

  // Braking for a red or red+amber (or an amber with room to stop) at the end of edge f, `d` metres ahead
  function signalAhead(v, f, d) {
    if (v.isPolice || !f.to.signal || d > LOOKAHEAD) return 0;
    const phase = phaseOf(f);
    if (phase === 'green' || (phase === 'amber' && !canStopBefore(v, d))) return 0;
    return stopAt(v, d);
  }

  // Mostly straight on, sometimes a turn (buses keep to wide roads). Routes don't follow the camera;
  // distant vehicles are recycled instead. With `fromLane`, only moves the current lane allows.
  const weights = [];
  function chooseMove(v, fromLane) {
    const e = v.edge;
    let total = 0;
    for (let k = 0; k < e.moves.length; k++) {
      const m = e.moves[k];
      let w = m.turn === 'S' ? (v.bus ? 8 : 3) : 1;
      if (v.bus && m.turn !== 'S' && m.to.lanes.length < 2) w *= 0.05;
      if (fromLane) {
        if (m.out[v.lane] < 0) w = 0;
      } else if (Math.abs(nearestLane(m, v.lane) - v.lane) * 22 > e.len - v.s) {
        w *= 0.02; // too little road left to change lanes for it
      }
      weights[k] = w;
      total += w;
    }
    let r = Math.random() * total;
    let pick = null;
    for (let k = 0; k < e.moves.length; k++) {
      if (weights[k] <= 0) continue;
      pick = e.moves[k];
      r -= weights[k];
      if (r < 0) break;
    }
    // No move from this lane (a lane the road graph couldn't lead anywhere): take any move, changing lanes for it
    if (!pick && fromLane) return chooseMove(v, false);
    return pick || e.moves[0] || null;
  }

  // Could the vehicle of lane entry o, approaching the end of edge a, still stop easily before its line? Vehicles
  // already standing can; drivers who have been waiting a while accept any gap it can still stop for comfortably.
  function canStop(o, a, impatient) {
    const sp = o.v.speed;
    if (sp < 0.5) return true;
    const d = a.len - o.s - o.v.half;
    return impatient ? canStopBefore(o.v, d) : d > (sp * sp) / 5 + sp + 3;
  }

  // A left turn waits for oncoming traffic going straight or right (approach o); vehicles not on o yet haven't picked
  // their way on, and at a red, only police and those already committed to crossing still come. Waiting at the line, v
  // also takes turns with those waiting at theirs: whoever has waited longer goes first, if it has room to go.
  function yieldOncoming(o, impatient, v = null) {
    if (!o) return false;
    if (o.through > 0) return true;
    const phase = o.to.signal ? phaseOf(o) : 'green';
    const red = phase === 'red' || phase === 'redAmber';
    for (const list of o.occ) {
      const lead = leadOf(list);
      if (!lead || (lead.v.edge === o && lead.v.move.turn === 'L')) continue;
      if (red && !lead.v.isPolice) continue;
      if (!canStop(lead, o, impatient)) return true;
      const u = lead.v;
      const j = u.edge === o ? u.move.out[u.lane] : -1;
      if (v && v.wait > 0 && u.wait > v.wait && j >= 0 && o.len - lead.s - u.half < 2 && room(u.move.to, j, u)) return true;
    }
    return false;
  }

  // How far along curve c, out of two-way edge e, v can pull forward before its front corner reaches the
  // oncoming lanes (left of the centre line): where it waits for a gap to turn left
  const corner = { x: 0, z: 0, dx: 0, dz: 1 };
  function yieldPoint(v, c, e) {
    let cs = 0;
    const threshold = (!e.lanes || e.lanes.length === 1) && e.opposite ? 0 : 0.3;
    for (; cs < c.len; cs += 0.5) {
      curvePoint(c, cs + v.half, corner);
      const x = corner.x + corner.dz * v.halfWidth;
      const z = corner.z - corner.dx * v.halfWidth;
      if ((x - e.x0) * e.rx + (z - e.z0) * e.rz < threshold) break;
    }
    return cs - 0.5;
  }

  // At unsignalized corners, give way to the main road. Police passing a non-green signal yield to approaching
  // cross traffic as well as vehicles already in the intersection, instead of treating the light as a clear road.
  function yieldToCrossTraffic(v, n) {
    for (const a of n.in) {
      if (n.signal ? a.axisIndex === v.edge.axisIndex : a.axisIndex !== 0) continue;
      for (const list of a.occ) {
        const lead = leadOf(list);
        if (lead && !canStop(lead, a, !n.signal && v.wait > 8)) return true;
      }
    }
    return false;
  }

  // Seconds v takes to cover dist metres from now, speeding up from rest if it has to
  const timeTo = (v, dist) => dist / Math.max(v.speed, Math.sqrt((v.driver.a * dist) / 2), 0.1);

  // Will anyone on crosswalk `side` of n be within reach of the lane meeting it at `coord` between t0 and t1
  // seconds from now? Unless `onIt`, so is anyone waiting at the curb to step off, however far away: on the WALK, they
  // only wait for the vehicles already holding the crosswalk.
  function pedestrianOn(n, side, coord, t0, t1, onIt = false) {
    for (const p of n.walkers) {
      if (onIt && p.waiting) continue;
      if (p.side !== side) {
        const sides = p.sides || p.route?.sides;
        // The peer is crossed inside its connector, where a turning car has already shifted away from its lane
        // coordinate at the stop line. Reserve that whole approach until the shared walk is clear.
        if (sides) for (const owned of sides) if (owned.side === side) return true;
        continue;
      }
      const toGo = (coord - p.coord) * p.dir; // metres p still has to walk to get there
      if (p.waiting || ((toGo + 2.6) / p.speed > t0 && (toGo - 2.6) / p.speed < t1)) return true;
    }
    return false;
  }

  // How far before the end of a connector into f its crosswalk starts, with 0.5 m to spare (road-network.js: the stop
  // line f starts at is setbackFrom beyond the CROSSWALK band)
  const shortOfZebra = (f) => f.setbackFrom + CROSSWALK + 0.5;

  // ...on the crosswalk v leaves the intersection over, while v, its front bumper d metres before it, passes? Once v
  // holds that crosswalk (it isn't waiting inside to turn), people at the curb wait for it.
  const pedsOut = (v, d) => d > 0 && pedestrianOn(v.edge.to, v.move.to.outSide, laneCoord(v.move.to, v.out, v.move.to.outArm), timeTo(v, d), timeTo(v, d + 0.5 + CROSSWALK + 2 * v.half), !v.yielding);

  // Must v, pulled into the intersection to turn, wait there: for people crossing its way out (`peds`) or, turning
  // left, for oncoming traffic?
  const holdsOn = (v, peds) => peds || (v.move.turn === 'L' && yieldOncoming(v.edge.opposite, false));

  // Before the stop line, fronts determine merge order. Once queued at the line, retain arrival order so a
  // newcomer stopping a few centimetres farther forward cannot repeatedly jump ahead of a waiting lane.
  const precedence = (u, s) => s + u.half;
  function mergeFirst(u, us, v, vs) {
    const ua = Number.isFinite(u.mergeArrival), va = Number.isFinite(v.mergeArrival);
    if (ua !== va) return ua;
    if (ua && u.mergeArrival !== v.mergeArrival) return u.mergeArrival < v.mergeArrival;
    if (!ua && precedence(u, us) !== precedence(v, vs)) return precedence(u, us) > precedence(v, vs);
    return u.lane < v.lane;
  }

  // Would there be room for v in lane j of edge f if everyone headed there queued bumper to bumper behind its far
  // stop line? (An empty lane always has room, however short.) Rank approaches by their oldest eligible waiting
  // lead, then fronts within that approach. Ranking individual wait across roads and fronts within one road was
  // non-transitive: three cars could each reserve the same empty exit against the next at Kaponiera.
  function room(f, j, v) {
    let free = f.len - 1;
    for (const o of f.occ[j]) if (o.v !== v && o.s - o.v.half < f.len) free -= 2 * o.v.half + o.v.driver.s0;
    let priority = null, waited = 0, arrival = Infinity;
    for (const a of f.from.in) {
      for (const list of a.occ) {
        const o = leadOf(list);
        if (!o || o.v.claimed || !o.v.move || o.v.move.to !== f || o.v.move.out[o.v.lane] !== j) continue;
        if (a.to.signal && !o.v.isPolice && o.v.commit !== a.to && phaseOf(a) !== 'green') continue;
        const at = Number.isFinite(o.v.mergeArrival) ? o.v.mergeArrival : Infinity;
        const first = Number.isFinite(at) ? priority && a.id < priority.id
          : o.v.wait > waited || (priority && o.v.wait === waited && a.id < priority.id);
        if (at < arrival || (at === arrival && first)) {
          priority = a;
          waited = o.v.wait;
          arrival = at;
        }
      }
    }
    for (const a of f.from.in) {
      for (const list of a.occ) {
        const o = leadOf(list);
        if (!o || o.v.claimed || !o.v.move || o.v.move.to !== f || o.v.move.out[o.v.lane] !== j) continue;
        if (a.to.signal && !o.v.isPolice && o.v.commit !== a.to && phaseOf(a) !== 'green') continue;
        const first = a === v.edge ? mergeFirst(o.v, o.s, v, v.s) : a === priority;
        if (first) free -= 2 * o.v.half + o.v.driver.s0;
      }
    }
    return free >= Math.min(2 * v.half + 0.5, f.len - 1);
  }

  // Would v, crossing into lane j of f to arrive at position vs, come alongside another vehicle headed there, cut in
  // ahead of one closing in on it, or close in on one ahead in a lane beside (which it doesn't follow)? Turning buses
  // swing wide, so where a bus turns, the lanes either side count too, and for one turning beside v from v's road, so
  // does how far apart they start turning (the outer one has further to go: side by side on f may be one behind the
  // other at the line, and the other way round).
  function alongside(f, j, v, vs, turn) {
    for (let k = Math.max(0, j - 1); k <= Math.min(f.lanes.length - 1, j + 1); k++) {
      for (const o of f.occ[k]) {
        const swing = turn && (v.bus || o.v.bus);
        if (o.v === v || (k !== j && !swing)) continue;
        let lo = o.s - vs; // how far ahead of v o is
        let hi = lo;
        if (swing && o.v.edge === v.edge) {
          const atLine = (o.v.conn ? v.edge.len + o.v.cs : o.v.s) - v.s;
          lo = Math.min(lo, atLine);
          hi = Math.max(hi, atLine);
        }
        const closing = hi < 0 ? o.v.speed - v.speed : lo > 0 && k !== j ? v.speed - o.v.speed : 0;
        const w = o.v.half + v.half + 1 + 2 * Math.max(0, closing);
        if (lo < w && hi > -w) return true;
      }
    }
    return false;
  }

  // Is a bus at the line in the lane on the outside of v's turn? A bus starting to turn swings its tail out over it.
  function besideTail(v) {
    const e = v.edge;
    const k = v.lane + (v.move.turn === 'R' ? -1 : 1);
    const o = v.move.turn !== 'S' && k >= 0 && k < e.lanes.length ? leadOf(e.occ[k]) : null;
    return !!o && o.v.bus && o.v !== v && e.len - o.s - o.v.half < 2;
  }

  // The lead of another of v's lanes that goes first into lane j of f or, turning where a bus is involved, into a lane
  // beside it (turning buses swing wide): v falls in behind it. As an entry { v, s } of f's lane: where it would be on
  // f now.
  const merger = { v: null, s: 0 };
  function mergingAhead(v, f, j) {
    const e = v.edge;
    merger.v = null;
    for (let i = 0; i < e.lanes.length; i++) {
      const o = i === v.lane ? null : leadOf(e.occ[i]);
      if (!o || o.v === v || o.v.claimed || o.v.move.to !== f || !mergeFirst(o.v, o.s, v, v.s)) continue;
      if (o.v.bus && besideTail(o.v)) continue; // it waits for the bus beside its tail
      const oj = o.v.move.out[o.v.lane];
      if (oj < 0 || (oj !== j && !(Math.abs(oj - j) === 1 && v.move.turn !== 'S' && (v.bus || o.v.bus)))) continue;
      const s = o.s - e.len - connector(e, o.v.lane, f, oj).len;
      if (!merger.v || s < merger.s) {
        merger.v = o.v;
        merger.s = s;
      }
    }
    return merger.v ? merger : null;
  }

  // Why v may not enter (v.held): read by accelerate for v.waitReason, which tools/bench-traffic.mjs reports
  const refuse = (v, why) => {
    v.held = why;
    return false;
  };

  // May v, its front bumper d metres before the stop line, enter the intersection now? Sets the exit lane.
  // Once too close to stop, v is committed: it goes, and holds the intersection from then on.
  function mayEnter(v, d) {
    const e = v.edge;
    const n = e.to;
    // Both lane leads at the line have arrived even if IDM leaves one a few centimetres farther back. Keep
    // that queue order through acceleration, so repeated newcomers cannot starve the same waiting van.
    if (d <= 2 && !Number.isFinite(v.mergeArrival)) v.mergeArrival = clock;
    const phase = n.signal ? phaseOf(e) : 'green';
    // Could it still stop? For a light that isn't green, also by crawling up to it, closer than it stops for lines
    const stoppable = canStopBefore(v, d) || (phase !== 'green' && v.speed * v.speed < 2 * v.driver.b * d);
    if (stoppable) v.commit = null; // could stop after all: decide afresh
    if (v.commit === n) return true;
    if (v.move.out[v.lane] < 0) {
      // missed the lane for the planned move: go wherever this lane goes instead
      if (d > 12) return refuse(v, 'lane');
      v.move = chooseMove(v, true);
    }
    const m = v.move;
    const f = m.to;
    const j = m.out[v.lane];
    if (!(j >= 0 && j < f.lanes.length)) {
      if (!mayEnter.warned) {
        mayEnter.warned = true;
        console.warn('[traffic] lane leads nowhere', { lane: v.lane, lanes: e.lanes.length, out: m.out.slice(), moves: e.moves.length, x: Math.round(v.x), z: Math.round(v.z) });
      }
      return refuse(v, 'lane');
    }
    const c = connector(e, v.lane, f, j);
    if (!v.isPolice && (phase === 'red' || phase === 'redAmber' || (phase === 'amber' && stoppable))) return refuse(v, 'signal');
    if (boxBusy(n, e.axisIndex, v)) return refuse(v, 'box'); // crossing traffic inside
    if (tramBlocks(v, n, f, j)) return refuse(v, 'tram'); // a tram over its way across, or coming up to it
    const lead = ahead(e.occ[v.lane], v.s, v);
    if (lead && lead.v.yielding) {
      const clearsStraight = v.move.turn !== 'L' && lead.v.move.turn === 'L' && lead.v.conn &&
        (typeof boxConflictEnd === 'function' ? lead.v.cs - lead.v.half > boxConflictEnd(c, lead.v.conn, v.halfWidth + lead.v.halfWidth, lead.v.half) : false);
      if (!clearsStraight) return refuse(v, 'turner'); // the vehicle ahead waits inside to turn: wait behind the line
    }
    if (v.bus && besideTail(v)) return refuse(v, 'bus'); // its tail would swing out over that bus as it starts to turn
    // At a signal or priority road, the first in line to turn pulls into the intersection to wait there for the people crossing the
    // road it turns into (they walk on the same green): short of their crosswalk or, turning left across oncoming
    // traffic, short of the oncoming lanes until there is a gap. The light changing stops both for it at the latest.
    const first = n.signal && (!v.isPolice || phase === 'green') && m.turn !== 'S' && !lead;
    const across = m.turn === 'L' && !!e.opposite;
    const wait = first ? (across ? yieldPoint(v, c, e) : c.len - shortOfZebra(f) - v.half) : -1; // < 0: no room inside to wait
    if (m.turn === 'L' ? across && wait < 0 && yieldOncoming(e.opposite, v.wait > 8, v)
      : e.opposite && boxBusy(n, e.axisIndex, v, e.opposite)) return refuse(v, 'oncoming');
    if ((n.signal ? v.isPolice && phase !== 'green' : e.axisIndex !== 0) && yieldToCrossTraffic(v, n)) return refuse(v, 'crossing');
    // nobody on the crosswalks while it passes over them, on the way in and on the way out, and a free place to
    // clear the intersection to, taking turns with lanes merging into it
    // (once its turn has come at an unsignalised zebra, people still at the curb wait for it: see courtesy)
    const turn = v.pedWait > PED_COURTESY && !n.signal;
    if (pedestrianOn(n, e.inSide, laneCoord(e, v.lane, e.inArm), 0, timeTo(v, d + (e.crosswalkEnd ?? e.setbackTo + CROSSWALK) + 2 * v.half), turn)) return refuse(v, 'pedestrian');
    if (wait < 0 && pedestrianOn(n, f.outSide, laneCoord(f, j, f.outArm), timeTo(v, d + c.len - shortOfZebra(f)), timeTo(v, d + c.len - f.setbackFrom + 2 * v.half), turn)) return refuse(v, 'pedestrian');
    const vs = v.s - e.len - c.len; // where on f it would be now
    if (!room(f, j, v)) return refuse(v, 'room');
    if (alongside(f, j, v, vs, m.turn !== 'S') || mergingAhead(v, f, j)) return refuse(v, 'merge');
    v.out = j;
    v.yielding = wait >= 0;
    v.yieldAt = wait;
    if (!stoppable) {
      v.commit = n;
      claim(v); // at once, so vehicles and pedestrians deciding later this frame know
    }
    return true;
  }

  // Overtake into an adjacent lane when it is clearly quicker (MOBIL), or work towards a lane the planned turn
  // can be made from; either only if neither v nor its new follower has to brake hard for it. Not while still
  // pulling out of an intersection, nor in the last 12 m before the next.
  function changeLanes(v) {
    const e = v.edge;
    if (v.conn || v.commit || Math.abs(v.dl) > 0.5 || v.s < v.half || e.len - v.s - v.half < 12) return;
    let target = -1;
    if (v.move.out[v.lane] < 0) {
      const t = v.lane + Math.sign(nearestLane(v.move, v.lane) - v.lane);
      if (laneSafe(v, t, -4)) target = t;
    } else if (v.speed > 2) {
      let best = laneAcc(v, v.lane) + 0.6;
      for (let t = v.lane - 1; t <= v.lane + 1; t += 2) {
        if (t < 0 || t >= e.lanes.length || v.move.out[t] < 0 || !laneSafe(v, t, -3)) continue;
        const acc = laneAcc(v, t);
        if (acc > best) {
          best = acc;
          target = t;
        }
      }
    }
    if (target < 0) return;
    v.dl += e.lanes[v.lane] - e.lanes[target]; // same spot, now measured from the new lane's centre
    v.lane = target;
    v.trail = null;
  }

  // Can v move into lane t leaving itself and its new follower at least bSafe (negative) acceleration?
  function laneSafe(v, t, bSafe) {
    let lead = null;
    let back = null;
    for (const o of v.edge.occ[t]) {
      if (o.v === v) continue;
      if (o.s > v.s) {
        lead = o;
        break;
      }
      back = o;
    }
    if (lead) {
      const gap = lead.s - lead.v.half - v.s - v.half;
      if (gap < 1.5 || freeAcc(v) + brake(v, gap, lead.v.speed) < bSafe) return false;
    }
    if (back) {
      const f = back.v;
      const gap = v.s - v.half - back.s - f.half;
      if (gap < 1.5 || freeAcc(f) + brake(f, gap, v.speed) < bSafe) return false;
    }
    const off = v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl;
    const reach = v.half + player.halfL + 6;
    return !(Math.abs(v.pRight - off) < v.halfWidth + player.halfW + 0.4 && v.pAhead > -reach && v.pAhead < reach);
  }

  // Acceleration v would have in lane t behind the vehicle (or player) ahead there
  function laneAcc(v, t) {
    const o = ahead(v.edge.occ[t], v.s, v);
    let worst = o ? brake(v, o.s - o.v.half - v.s - v.half, o.v.speed) : 0;
    const pg = playerGap(v, v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl);
    if (pg < LOOKAHEAD) worst = Math.min(worst, brake(v, pg, v.pSpeed));
    return freeAcc(v) + worst;
  }

  // Brake for the bends ahead, rather than crawling through a whole connector at its sharpest point's speed.
  // The 38.7 m turn at Św. Marcin has a short 0.9 m/s exit kink; applying it to the entire curve held a queue
  // for over 40 s. Profiles reuse the quarter-metre curvature samples and are cached for the two driver classes.
  function bendSpeed(v, c, s = 0) {
    if (!c.lut || c.len <= 1e-6) return Math.sqrt(v.driver.aLat / Math.max(c.curv, 1e-3));
    if (!c.bendProfiles) c.bendProfiles = new Map();
    let speeds = c.bendProfiles.get(v.driver);
    if (!speeds) {
      boxSamples(c);
      const bends = c.boxBends;
      speeds = new Float64Array(bends.length);
      const step = c.len / (bends.length - 1);
      for (let i = bends.length - 1; i >= 0; i--) {
        const curvature = Math.max(bends[Math.max(0, i - 1)], bends[i], bends[Math.min(bends.length - 1, i + 1)], 1e-3);
        const local = v.driver.aLat / curvature;
        speeds[i] = i === bends.length - 1 ? local : Math.min(local, speeds[i + 1] + 2 * v.driver.b * step);
      }
      c.bendProfiles.set(v.driver, speeds);
    }
    const i = Math.min(speeds.length - 1, Math.max(0, Math.floor(s / c.len * (speeds.length - 1))));
    return Math.sqrt(Math.min(speeds[i], speeds[Math.min(i + 1, speeds.length - 1)]));
  }

  // IDM acceleration for vehicles ahead in the lane (and, through the intersection, in the lane it leads to),
  // the stop line while v may not go, a red beyond, the player, and slowing down for turns and give-way lines.
  // v.waitReason names the binding term, as a tram's does: 'car' (v.leader ahead), why mayEnter refused (v.held:
  // 'signal', 'box', 'tram', 'turner', 'bus', 'oncoming', 'crossing', 'pedestrian', 'room', 'merge', 'lane'), 'signal'
  // (a red beyond), 'merge', 'turn' (waiting inside to turn), 'pedestrian' (inside, for walkers on its way out),
  // 'player', or '' (none)
  function accelerate(v) {
    const e = v.edge;
    let worst = 0;
    let why = '';
    let cap = Infinity;
    let t = 0;
    v.gap = Infinity;
    v.leader = null;
    if (!v.conn) {
      worst = follow(v, e.occ[v.lane], v.s);
      const side = straddle(v);
      if (side) worst = Math.min(worst, follow(v, e.occ[v.lane + side], v.s));
      if (worst < 0) why = 'car';
      const d = e.len - v.s - v.half;
      if (d < LOOKAHEAD) {
        const go = mayEnter(v, d);
        const f = v.move.to;
        const j = v.move.out[v.lane];
        const c = j < 0 ? null : connector(e, v.lane, f, j);
        const vs = c ? v.s - e.len - c.len : 0; // position on f, measured from its start
        if (!go) {
          if ((t = stopAt(v, d)) < worst) { worst = t; why = v.held; }
        } else {
          if ((t = follow(v, f.occ[j], vs)) < worst) { worst = t; why = 'car'; }
          if ((t = signalAhead(v, f, f.len - vs - v.half)) < worst) { worst = t; why = 'signal'; }
          // pulling in to wait inside: slow down for that spot already if it will have to wait there
          if (v.yielding && holdsOn(v, pedsOut(v, d + c.len - shortOfZebra(f)))) {
            if ((t = stopAt(v, d + v.half + v.yieldAt, 0.5)) < worst) { worst = t; why = 'turn'; }
          }
        }
        // easing off to fall in behind a vehicle from another lane merging ahead into the same lane (unless committed:
        // then the others wait for v)
        const o = c && !v.claimed && mergingAhead(v, f, j);
        if (o && (t = Math.max(-v.driver.b, brake(v, o.s - o.v.half - vs - v.half, o.v.speed))) < worst) { worst = t; why = 'merge'; }
        // the next edge's limit, eased down to like a bend (a 30 zone sign at the junction: 50 -> 30 km/h over ~25 m)
        let vt = Math.min(c ? bendSpeed(v, c) : Infinity, desiredOn(v, f));
        const cautious = e.to.signal ? v.isPolice && phaseOf(e) !== 'green' : e.axisIndex !== 0;
        if (cautious) vt = Math.min(vt, 5);
        if (v.dl > 0.4 && e.lanes.length === 1) vt = Math.min(vt, 20 / 3.6);
        cap = Math.sqrt(vt * vt + 5 * Math.max(0, d));
      }
      if (v.dl > 0.4 && e.lanes.length === 1) cap = Math.min(cap, 20 / 3.6);
    } else {
      const f = v.move.to;
      const vs = v.cs - v.conn.len;
      worst = Math.min(follow(v, f.occ[v.out], vs), follow(v, e.occ[v.lane], e.len + v.cs));
      if (worst < 0) why = 'car';
      if ((t = signalAhead(v, f, f.len - vs - v.half)) < worst) { worst = t; why = 'signal'; }
      // someone crossing the way out: wait for them inside the intersection, short of the crosswalk
      const d = v.conn.len - shortOfZebra(f) - v.cs - v.half;
      const peds = pedsOut(v, d);
      if (v.yielding && v.cs < v.yieldAt && holdsOn(v, peds)) {
        if ((t = stopAt(v, v.yieldAt - v.cs, 0.5)) < worst) { worst = t; why = 'turn'; } // waiting inside to turn
      } else {
        if (v.yielding) cross(v);
        if (peds && (t = stopAt(v, d, 0.5)) < worst) { worst = t; why = 'pedestrian'; }
      }
      cap = Math.min(bendSpeed(v, v.conn, v.cs),
        Math.sqrt(desiredOn(v, f) ** 2 + 2 * v.driver.b * Math.max(0, v.conn.len - v.cs)));
    }
    const pg = playerGap(v, 0);
    if (pg < LOOKAHEAD) {
      if ((t = brake(v, pg, v.pSpeed)) < worst) { worst = t; why = 'player'; }
      if (pg < v.gap) {
        v.gap = pg;
        v.leaderSpeed = v.pSpeed;
        v.leader = null;
      }
    }
    v.waitReason = why;
    const acc = Math.min(freeAcc(v) + worst, (cap - v.speed) * 2);
    v.acc = clamp(acc, -9, v.driver.a);
  }

  // Front bumper at the stop line: cross if allowed, or if going too fast to stop; otherwise wait there
  function enter(v) {
    const e = v.edge;
    if (!mayEnter(v, 0)) {
      const j = v.move.out[v.lane];
      if (v.speed < 4 || j < 0) {
        v.s = e.len - v.half;
        v.speed = 0;
        return;
      }
      v.out = j;
      v.yielding = false;
    }
    v.cs = v.s - e.len;
    v.conn = connector(e, v.lane, v.move.to, v.out);
    claim(v); // at once, so vehicles deciding later this frame know
  }

  function leave(v) {
    v.mergeArrival = Infinity;
    v.s = v.cs - v.conn.len;
    v.edge = v.move.to;
    v.v0 = desiredOn(v, v.edge);
    v.lane = v.out;
    v.trail = v.conn; // the rear axle is still on it
    v.conn = null;
    v.commit = null;
    v.move = chooseMove(v, false);
  }

  function drive(v, dt) {
    v.laneTimer -= dt;
    if (v.laneTimer <= 0) {
      v.laneTimer = 0.4 + Math.random() * 0.3;
      changeLanes(v);
    }
    accelerate(v);
    const speed = v.speed;
    v.speed = Math.max(0, v.speed + v.acc * dt);
    let ds = v.speed * dt;
    if (ds > v.gap - 0.3) {
      // never into the vehicle ahead
      ds = Math.max(0, v.gap - 0.3);
      v.speed = Math.min(v.speed, v.leaderSpeed);
    }
    v.acc = Math.max(-9, (v.speed - speed) / dt); // as driven, for the body to pitch with: none standing still
    v.wait = v.speed < 0.5 ? v.wait + dt : 0;
    // how long it has stood held up by people crossing (kept while it stands for anything else)
    v.pedWait = v.speed >= 0.5 ? 0 : v.waitReason === 'pedestrian' ? v.pedWait + dt : v.pedWait;
    if (!v.conn) {
      v.s += ds;
      if (v.s + v.half >= v.edge.len) enter(v);
    } else {
      v.cs += ds;
      if (v.cs >= v.conn.len) leave(v);
    }
    // ease sideways onto the lane centre (after lane changes and knocks), steering the front bumper towards it so the
    // nose doesn't swing on into the next lane, and no faster than the wheels can steer it, though even stopped half
    // way into a lane change a driver edges over
    let targetDl = 0;
    if (!v.conn && v.edge && (!v.edge.lanes || v.edge.lanes.length === 1)) {
      if (v.move && v.move.turn === 'L' && v.edge.opposite && v.edge.len - v.s < 30) {
        targetDl = -Math.min(0.85, Math.max(0, v.edge.lanes[0] - v.halfWidth - 0.12));
      } else if (v.move && v.move.turn !== 'L') {
        const o = ahead(v.edge.occ[0], v.s, v);
        if (o && o.v.move && o.v.move.turn === 'L' && o.v.speed < 1.5 && (o.v.yielding || o.v.waitReason === 'oncoming' || o.v.held === 'oncoming' || o.v.waitReason === 'turn')) {
          const roomRight = v.edge.half - (v.edge.lanes[0] + o.v.dl + o.v.halfWidth);
          if (roomRight >= 2 * v.halfWidth + 0.08) {
            targetDl = Math.min(v.edge.half - v.halfWidth - 0.12 - v.edge.lanes[0], 0.95);
          }
        }
      }
    }
    const maxLat = Math.min(1.7, 0.3 + (v.bus ? 0.1 : 0.22) * v.speed);
    const rate = Math.min(1.8, Math.max(v.speed, 1.5) / (v.axle + v.half));
    const target = clamp(-rate * (v.dl - targetDl), -maxLat, maxLat);
    v.dlv += clamp(target - v.dlv, -2.5 * dt, 2.5 * dt);
    v.dl += v.dlv * dt;
  }

  // Point and direction at distance c along v's path: its lane, the curve through the intersection, and the
  // lane after it (or, just out of an intersection, the curve it came along)
  function lanePoint(e, i, s, out) {
    out.x = e.sx + e.dx * s + e.rx * e.lanes[i];
    out.z = e.sz + e.dz * s + e.rz * e.lanes[i];
    out.dx = e.dx;
    out.dz = e.dz;
    return out;
  }
  function pathPoint(v, c, out) {
    const e = v.edge;
    if (v.conn) {
      if (c < 0) return lanePoint(e, v.lane, e.len + c, out);
      if (c > v.conn.len) return lanePoint(v.move.to, v.out, c - v.conn.len, out);
      return curvePoint(v.conn, c, out);
    }
    if (c < 0 && v.trail) return curvePoint(v.trail, v.trail.len + c, out);
    return lanePoint(e, v.lane, c, out);
  }

  // World position and heading from where v's axles are along its path: the rear axle dl to the right of it, and the
  // body turned `nose` to the right about the rear axle, into a lane change (so the rear axle never slides sideways)
  const front = { x: 0, z: 0, dx: 0, dz: 0 };
  const rear = { x: 0, z: 0, dx: 0, dz: 0 };
  function locate(v) {
    const c = v.conn ? v.cs : v.s;
    pathPoint(v, c + v.axle, front);
    pathPoint(v, c - v.axle, rear);
    const l = Math.hypot(front.x - rear.x, front.z - rear.z) || 1;
    v.tx = (front.x - rear.x) / l;
    v.tz = (front.z - rear.z) / l;
    v.nose = Math.atan2(v.dlv, Math.max(v.speed, 1.5));
    const off = v.dl + v.axle * Math.sin(v.nose);
    v.x = (front.x + rear.x) / 2 - v.tz * off;
    v.z = (front.z + rear.z) / 2 + v.tx * off;
  }

  // Move v along and across its path by (dx, dz), as far as the road allows
  function shove(v, dx, dz) {
    const along = dx * v.tx + dz * v.tz;
    if (v.conn) v.cs = clamp(v.cs + along, -v.half, v.conn.len - 0.01);
    else v.s = clamp(v.s + along, 0, v.edge.len - v.half);
    v.dl = clamp(v.dl + dz * v.tx - dx * v.tz, -2.5, 2.5);
    locate(v);
  }

  // Heading, steering, turn signals, and body pitch & roll from acceleration & turning
  function pose(v, dt) {
    const yaw = Math.atan2(v.tx, v.tz) - v.nose;
    let dYaw = yaw - v.yaw;
    dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
    v.yaw = yaw;
    v.yawRate += (dYaw / dt - v.yawRate) * Math.min(1, dt * 8);
    const wheelbase = 2 * v.axle;
    const steer = clamp(Math.atan((wheelbase * v.yawRate) / Math.max(v.speed, 0.5)), -0.6, 0.6);
    v.steer += (steer - v.steer) * Math.min(1, dt * 10);

    const turn = v.move.turn;
    if (Math.abs(v.dl) > 0.3 && Math.abs(v.dlv) > 0.05) v.blink = v.dl > 0 ? -1 : 1;
    else if (turn !== 'S' && (v.conn || v.edge.len - v.s < 35)) v.blink = turn === 'R' ? 1 : -1;
    else v.blink = 0;

    v.pitchVel += ((-0.008 * v.acc - v.pitch) * 68.0 - v.pitchVel * 10.8) * dt;
    v.pitch = clamp(v.pitch + v.pitchVel * dt, -0.22, 0.22);
    v.rollVel += ((0.01 * v.speed * v.yawRate - v.roll) * 68.0 - v.rollVel * 10.8) * dt;
    v.roll = clamp(v.roll + v.rollVel * dt, -0.26, 0.26);
    v.yawOffset += v.yawVel * dt;
    v.yawVel += (-v.yawOffset * 18.0 - v.yawVel * 6.8) * dt;
    v.yawOffset = clamp(v.yawOffset * Math.exp(-4.5 * dt), -0.85, 0.85);
  }

  // Knock velocity from collisions carries v along and across its path, and dies down
  function knock(v, dt) {
    if (v.vx === 0 && v.vz === 0) return;
    shove(v, v.vx * dt, v.vz * dt);
    const damp = Math.exp(-5.5 * dt);
    v.vx *= damp;
    v.vz *= damp;
    if (v.vx * v.vx + v.vz * v.vz < 1e-4) v.vx = v.vz = 0;
  }

  // A knocked vehicle shunts the vehicles it runs into
  function knockOn(v) {
    for (const o of vehicles) {
      if (o === v || !o.edge) continue;
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist > v.half + o.half || dist < 0.001) continue;
      if (Math.abs(dz * v.tx - dx * v.tz) > v.halfWidth + o.halfWidth) continue; // side by side
      const nx = dx / dist;
      const nz = dz / dist;
      const relVn = (v.vx - o.vx) * nx + (v.vz - o.vz) * nz;
      if (relVn <= 0.5) continue;
      const approachSpeed = (v.tx * v.speed + v.vx - o.tx * o.speed - o.vx) * nx
        + (v.tz * v.speed + v.vz - o.tz * o.speed - o.vz) * nz;
      reportCollision(o, v, (v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, approachSpeed);
      const transfer = relVn * 0.68;
      o.vx += nx * transfer;
      o.vz += nz * transfer;
      v.vx -= nx * transfer * 0.45;
      v.vz -= nz * transfer * 0.45;
      const across = nz * o.tx - nx * o.tz; // hit from the side spins it
      const along = nx * o.tx + nz * o.tz;
      o.yawVel += across * Math.min(2.8, relVn * 0.22);
      o.rollVel += across * Math.min(8.0, relVn) * 0.18;
      o.pitchVel -= along * Math.min(8.0, relVn) * 0.14;
      if (relVn > 2.2) spawnCollisionSparks((v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, relVn);
    }
  }

  // Physical 4-axis 2D SAT OBB test between a vehicle (half extents halfW x halfL, heading rotY) and the player.
  // Returns the minimum translation axis (pointing from the vehicle towards the player), or null if they don't overlap.
  const satHit = { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 };
  function overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pH, pHalfW, pHalfL) {
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const localX = relX * cosY - relZ * sinY;
    const localZ = relX * sinY + relZ * cosY;
    const pSin = Math.sin(pH);
    const pCos = Math.cos(pH);
    const pLocalX = relX * pCos - relZ * pSin;
    const pLocalZ = relX * pSin + relZ * pCos;
    const alignCos = Math.abs(Math.cos(pH - rotY));
    const alignSin = Math.abs(Math.sin(pH - rotY));

    const extX = halfW + pHalfW * alignCos + pHalfL * alignSin;
    const extZ = halfL + pHalfW * alignSin + pHalfL * alignCos;
    const pExtX = pHalfW + halfW * alignCos + halfL * alignSin;
    const pExtZ = pHalfL + halfW * alignSin + halfL * alignCos;

    const penX = extX - Math.abs(localX);
    const penZ = extZ - Math.abs(localZ);
    const pPenX = pExtX - Math.abs(pLocalX);
    const pPenZ = pExtZ - Math.abs(pLocalZ);
    if (!(penX > 0 && penZ > 0 && pPenX > 0 && pPenZ > 0)) return null;

    let nx, nz, pen;
    if (penX < penZ) {
      const signX = localX >= 0 ? 1 : -1;
      nx = cosY * signX;
      nz = -sinY * signX;
      pen = penX;
    } else {
      const signZ = localZ >= 0 ? 1 : -1;
      nx = sinY * signZ;
      nz = cosY * signZ;
      pen = penZ;
    }
    if (pPenX < pen) {
      const signPX = pLocalX >= 0 ? 1 : -1;
      nx = pCos * signPX;
      nz = -pSin * signPX;
      pen = pPenX;
    }
    if (pPenZ < pen) {
      const signPZ = pLocalZ >= 0 ? 1 : -1;
      nx = pSin * signPZ;
      nz = pCos * signPZ;
      pen = pPenZ;
    }

    satHit.nx = nx;
    satHit.nz = nz;
    satHit.pen = pen;
    satHit.localX = localX;
    satHit.localZ = localZ;
    satHit.pSin = pSin;
    satHit.pCos = pCos;
    return satHit;
  }

  // Player contact: push the player and the vehicle apart (a bus hardly moves) and trade momentum, with spin,
  // suspension kicks and sparks
  function collideWithPlayer(v, rotY, halfW, halfL, posX = v.x, posZ = v.z) {
    const pe = player.entity;
    const relX = pe.position.x - posX;
    const relZ = pe.position.z - posZ;
    if (Math.abs(relX) > halfL + 3 || Math.abs(relZ) > halfL + 3) return;
    const hit = overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pe.heading || 0, player.halfW, player.halfL);
    if (!hit) return;
    const { nx, nz, pen, localX, localZ, pSin, pCos } = hit;
    const massRatio = v.bus ? 0.15 : v.bodyType === 'fireTruck' ? 0.22 : v.isSUV ? 0.58 : 1.0 - player.push;
    const pPush = 1.0 - massRatio;
    pe.position.x += nx * pen * pPush;
    pe.position.z += nz * pen * pPush;
    if (pe.mesh) pe.mesh.position.copy(pe.position);
    shove(v, -nx * pen * massRatio, -nz * pen * massRatio);

    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const pSpeed = pe.speed || 0;
    const pvx = pSin * pSpeed + (pe.vx || 0);
    const pvz = pCos * pSpeed + (pe.vz || 0);
    const cvx = v.tx * v.speed + v.vx;
    const cvz = v.tz * v.speed + v.vz;
    const approachSpeed = (pvx - cvx) * (-nx) + (pvz - cvz) * (-nz);
    if (approachSpeed <= 0) return;

    const jImpulse = (1.0 + 0.28) * approachSpeed;
    const cImpulse = v.bus || v.bodyType === 'fireTruck' ? approachSpeed * 0.22 : jImpulse * massRatio * 0.92;
    v.vx -= nx * cImpulse;
    v.vz -= nz * cImpulse;
    v.speed *= v.bus || v.bodyType === 'fireTruck' ? 0.55 : 0.35;

    const localNx = nx * cosY - nz * sinY;
    const localNz = nx * sinY + nz * cosY;
    if (!v.bus) {
      const torque = localZ * localNx - localX * localNz;
      v.yawVel -= torque * Math.min(4.2, approachSpeed * 0.26);
      v.yawOffset = clamp(v.yawOffset - torque * Math.min(0.35, approachSpeed * 0.025), -0.65, 0.65);
      v.pitchVel -= localNz * Math.min(12.0, approachSpeed) * 0.18;
      v.rollVel += localNx * Math.min(12.0, approachSpeed) * 0.24;
    }

    const contactLocalX = clamp(localX, -halfW, halfW);
    const contactLocalZ = clamp(localZ, -halfL, halfL);
    const contactX = posX + contactLocalX * cosY + contactLocalZ * sinY;
    const contactZ = posZ - contactLocalX * sinY + contactLocalZ * cosY;
    if (pe.type !== 'person') reportCollision(pe, v, contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed);

    if (typeof pe.speed === 'number') {
      const headOnDot = Math.abs(pSin * nx + pCos * nz);
      pe.speed *= 1.0 - (v.bus ? 0.68 : 0.50) * headOnDot;
      if (pe.type === 'car') {
        const pImpulse = v.bus ? approachSpeed * 0.65 : jImpulse * pPush * 0.48;
        pe.vx = (pe.vx || 0) + nx * pImpulse;
        pe.vz = (pe.vz || 0) + nz * pImpulse;
        const pLocalNx = nx * pCos - nz * pSin;
        const pLocalNz = nx * pSin + nz * pCos;
        if (!v.bus) {
          const pRelX = (contactX - pe.position.x) * pCos - (contactZ - pe.position.z) * pSin;
          const pRelZ = (contactX - pe.position.x) * pSin + (contactZ - pe.position.z) * pCos;
          const pTorque = pRelZ * pLocalNx - pRelX * pLocalNz;
          pe.angularVel = (pe.angularVel || 0) + pTorque * Math.min(3.0, approachSpeed * 0.18) * pPush;
        }
        const kick = Math.min(v.bus ? 16.0 : 14.0, approachSpeed);
        pe.pitchVel = (pe.pitchVel || 0) + pLocalNz * kick * (v.bus ? 0.22 : 0.18);
        pe.rollVel = (pe.rollVel || 0) - pLocalNx * kick * (v.bus ? 0.28 : 0.24);
        pe.heaveVel = (pe.heaveVel || 0) + Math.min(v.bus ? 1.6 : 1.4, approachSpeed * (v.bus ? 0.14 : 0.11));
      }
    }
    if (approachSpeed > 1.8) spawnCollisionSparks(contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed);
  }

  // =========================================================================
  // 5B. TRAMS (js/trams.js, docs/actors.md "Trams"): cars yield to them, the player bumps into them
  // =========================================================================
  // trams.js maps the track onto the roads once (mapTramsToRoads): tram edge stretches over car lanes (te.lanes) and
  // junction curves over the track (te.junctions, node.tramConflicts). Every frame, after the cars, each tram goes into
  // the lanes under its body as a stand-in vehicle (a pooled proxy: cars follow it, queue behind it, keep room for it
  // and don't change lanes into it), reaching on a few metres ahead of its front in the lanes running its way and
  // further in lanes against it or across it (cars stop short of the track, not on it), but never over a car already
  // there. The junction curves its body is over, or will be within a few seconds, are held for it: mayEnter keeps cars
  // off them (tramBlocks). The trams brake for whatever is still in their way themselves (trams.js drive()).
  let trams = [];
  let tramGraph = null;
  let tramFrame = 0;
  const TRAM_PROXY_DRIVER = { a: 1.15, b: 1.4, T: 1.6, s0: 3.0, aLat: 0.9 };
  const TRAM_REACH = 70; // furthest ahead of its front a tram holds lanes across or against it and junction curves
  const tramProxies = [];
  let tramProxiesUsed = 0;
  function setTrams(system) {
    trams = system ? system.trams : [];
    tramGraph = system ? system.graph : null;
  }

  function occupyTrams() {
    tramProxiesUsed = 0;
    for (const t of trams) {
      const path = t.path;
      const rear = path.u - t.length;
      // lanes running its way: the body and just ahead of it; lanes against or across it, and junction curves: up to
      // a few seconds ahead, but no further than the body while it stands held by anything but a curve: waiting for
      // a car (let the cars ahead clear its way), at a stop or a red, behind another tram or at a switch. Holding the
      // curves ahead of a tram that can't go kept the cars of a green approach waiting behind it, and on a busy tram
      // junction (Most Teatralny) the cars there waited for a tram on their green and their red alike, 240 s
      const held = t.waitReason === 'car' || t.atStop || (t.speed < 1 && t.waitReason !== '' && t.waitReason !== 'curve');
      const near = path.u + 4 + t.speed;
      const far = path.u + (held ? 2 : Math.min(TRAM_REACH, 8 + t.speed * 6));
      // Conflict spans already include the tram's width. A stopped nose 0.5 m before a keep-clear gate must leave
      // its crossing free; the lane proxy's extra 2 m otherwise reserves it through the whole opposing green.
      const junctionFar = held && t.speed < 0.1 ? path.u : far;
      for (let i = 0; i < path.n; i++) {
        const te = path.edges[i];
        const base = path.start[i];
        if (base > far) break;
        if (base + te.len < rear) continue;
        const a = rear - base; // the body on te: [a, b]
        const b = path.u - base;
        for (const c of te.junctions) {
          if (c.s1 < a || c.s0 > junctionFar - base) continue;
          c.held = tramFrame;
          c.by = t;
        }
        for (const r of te.lanes) {
          const s0 = Math.max(a, r.s0);
          const s1 = Math.min((r.dir > 0 ? near : far) - base, r.s1);
          if (s1 <= s0) continue;
          // lane positions of [s0, s1] and of the body's part of it, widened by the tram's width along the lane
          const k = (r.l1 - r.l0) / Math.max(r.s1 - r.s0, 1e-6);
          const la = r.l0 + (s0 - r.s0) * k;
          const lb = r.l0 + (s1 - r.s0) * k;
          let lo = Math.min(la, lb) - r.pad;
          let hi = Math.max(la, lb) + r.pad;
          let blo = Infinity;
          let bhi = -Infinity;
          const b1 = Math.min(b, r.s1);
          if (b1 > s0) {
            const lc = r.l0 + (b1 - r.s0) * k;
            blo = Math.min(la, lc) - r.pad;
            bhi = Math.max(la, lc) + r.pad;
          }
          // a car already in the stretch ahead (or on the track the tram comes up to) keeps its place: the stretch
          // ends short of it
          const list = r.edge.occ[r.lane];
          let skip = false;
          for (const o of list) {
            if (o.v.tram) continue;
            const cLo = o.s - o.v.half;
            const cHi = o.s + o.v.half;
            if (cHi < lo || cLo > hi || (cHi >= blo && cLo <= bhi)) continue;
            if (blo > bhi) {
              if (r.dir === 0) {
                skip = true;
                break;
              }
              if (r.l1 >= r.l0) hi = Math.min(hi, cLo - 0.3);
              else lo = Math.max(lo, cHi + 0.3);
            } else if (cLo > bhi) hi = Math.min(hi, cLo - 0.3);
            else lo = Math.max(lo, cHi + 0.3);
          }
          if (skip || hi - lo < 0.5) continue;
          let p = tramProxies[tramProxiesUsed++];
          if (!p) {
            p = {
              tram: null, half: 0, halfWidth: 1.2, speed: 0, v0: 14, driver: TRAM_PROXY_DRIVER,
              edge: null, lane: -1, s: 0, conn: null, cs: 0, move: null, claimed: true, yielding: false,
              isPolice: false, bus: false, wait: 0
            };
            tramProxies.push(p);
          }
          p.tram = t;
          p.half = (hi - lo) * 0.5;
          p.speed = r.dir > 0 ? t.speed : 0;
          p.v0 = t.v0 || 14;
          p.s = (lo + hi) * 0.5;
          occupy(list, p, p.s);
        }
      }
    }
  }

  // Is the curve v would take through n (into lane j of f) held by a tram? Not for a car the tram is waiting for (it is
  // in its way already), nor for one ahead of it in a lane the tram runs along or right in front of it: the car is the
  // tram's leader and goes first.
  function tramBlocks(v, n, f, j) {
    const list = n.tramConflicts;
    if (!list) return false;
    for (const c of list) {
      if (c.held !== tramFrame || c.e !== v.edge || c.i !== v.lane || c.f !== f || c.j !== j) continue;
      const t = c.by;
      const front = t.sections[0];
      const hx = Math.sin(front.heading);
      const hz = Math.cos(front.heading);
      const dx = v.x - t.frontX;
      const dz = v.z - t.frontZ;
      if (t.obstacle === v) continue; // the tram is waiting for it
      if (dx * hx + dz * hz > -1 && (Math.abs(dx * hz - dz * hx) < front.halfWidth + v.halfWidth + 0.3 || inTramLane(t, v))) continue;
      return true;
    }
    return false;
  }
  // Is (x, z) within r of a tram's body? (Lane lists only hold the trams of the frame before: after a teleport the
  // trams are all somewhere new.)
  function nearTram(x, z, r) {
    for (const t of trams) {
      if (Math.abs(x - t.x) > t.length * 0.5 + r + 2 || Math.abs(z - t.z) > t.length * 0.5 + r + 2) continue;
      for (const sec of t.sections) {
        const dx = x - sec.x;
        const dz = z - sec.z;
        const hx = Math.sin(sec.heading);
        const hz = Math.cos(sec.heading);
        if (Math.abs(dx * hx + dz * hz) < sec.halfLength + r && Math.abs(dx * hz - dz * hx) < sec.halfWidth + r) return true;
      }
    }
    return false;
  }

  // Is v in a lane tram t runs along (the lane's way) between its front and TRAM_REACH ahead?
  function inTramLane(t, v) {
    const path = t.path;
    for (let i = path.indexAt(path.u); i < path.n && path.start[i] - path.u < TRAM_REACH; i++) {
      for (const r of path.edges[i].lanes) if (r.dir > 0 && r.edge === v.edge && r.lane === v.lane) return true;
    }
    return false;
  }

  // Player contact with a tram's sections (world OBBs): the tram is immovable, so the player takes the whole push
  // and a bus-like knock
  function collideWithTram(t) {
    const pe = player.entity;
    for (const sec of t.sections) {
      const relX = pe.position.x - sec.x;
      const relZ = pe.position.z - sec.z;
      if (Math.abs(relX) > sec.halfLength + 4 || Math.abs(relZ) > sec.halfLength + 4) continue;
      const hit = overlapWithPlayer(relX, relZ, sec.heading, sec.halfWidth, sec.halfLength, pe.heading || 0, player.halfW, player.halfL);
      if (!hit) continue;
      const { nx, nz, pen, localX, localZ, pSin, pCos } = hit;
      pe.position.x += nx * pen;
      pe.position.z += nz * pen;
      if (pe.mesh) pe.mesh.position.copy(pe.position);
      const pSpeed = pe.speed || 0;
      const pvx = pSin * pSpeed + (pe.vx || 0);
      const pvz = pCos * pSpeed + (pe.vz || 0);
      const tvx = Math.sin(sec.heading) * t.speed;
      const tvz = Math.cos(sec.heading) * t.speed;
      const approachSpeed = (pvx - tvx) * -nx + (pvz - tvz) * -nz;
      if (approachSpeed <= 0) continue;
      const sinY = Math.sin(sec.heading);
      const cosY = Math.cos(sec.heading);
      const contactLocalX = clamp(localX, -sec.halfWidth, sec.halfWidth);
      const contactLocalZ = clamp(localZ, -sec.halfLength, sec.halfLength);
      const contactX = sec.x + contactLocalX * cosY + contactLocalZ * sinY;
      const contactZ = sec.z - contactLocalX * sinY + contactLocalZ * cosY;
      if (pe.type !== 'person') reportCollision(pe, t, contactX, 0.8, contactZ, nx, nz, approachSpeed);
      if (typeof pe.speed === 'number') {
        const headOnDot = Math.abs(pSin * nx + pCos * nz);
        pe.speed *= 1.0 - 0.75 * headOnDot;
        if (pe.type === 'car') {
          const pImpulse = approachSpeed * 0.75;
          pe.vx = (pe.vx || 0) + nx * pImpulse;
          pe.vz = (pe.vz || 0) + nz * pImpulse;
          const pLocalNx = nx * pCos - nz * pSin;
          const pLocalNz = nx * pSin + nz * pCos;
          const kick = Math.min(16.0, approachSpeed);
          pe.pitchVel = (pe.pitchVel || 0) + pLocalNz * kick * 0.22;
          pe.rollVel = (pe.rollVel || 0) - pLocalNx * kick * 0.28;
          pe.heaveVel = (pe.heaveVel || 0) + Math.min(1.6, approachSpeed * 0.14);
        }
      }
      if (approachSpeed > 1.8) spawnCollisionSparks(contactX, 0.8, contactZ, nx, nz, approachSpeed);
    }
  }

  // =========================================================================
  // 6. PLACING VEHICLES
  // =========================================================================
  // Room at s in a lane list: margin metres to the vehicles either side, and two seconds more for the one behind
  function laneClear(list, s, margin) {
    for (const o of list) if (Math.abs(o.s - s) < o.v.half + margin + (o.s < s ? 2 * o.v.speed : 0)) return false;
    return true;
  }

  function place(v, e, lane, s) {
    v.mergeArrival = Infinity;
    v.edge = e;
    v.lane = lane;
    v.s = s;
    v.conn = null;
    v.trail = null;
    v.commit = null;
    v.yielding = false;
    v.wait = v.pedWait = 0;
    v.v0 = desiredOn(v, e);
    v.speed = v.v0 * 0.5;
    v.acc = 0;
    v.dl = v.dlv = 0;
    v.vx = v.vz = v.yawOffset = v.yawVel = v.pitch = v.pitchVel = v.roll = v.rollVel = 0;
    locate(v);
    v.prevX = v.x;
    v.prevZ = v.z;
    v.yaw = Math.atan2(v.tx, v.tz);
    v.yawRate = v.steer = 0;
    v.move = chooseMove(v, false);
    if (v.trailer) v.trailer.placed = false;
    occupy(e.occ[lane], v, s);
  }

  // Take v off the road until it is placed again; far off the map, so the radar draws no stale blip
  function park(v) {
    v.mergeArrival = Infinity;
    v.edge = null;
    v.conn = null;
    v.commit = null;
    v.speed = 0;
    if (v.trailer) v.trailer.placed = false;
    v.x = v.z = v.prevX = v.prevZ = 1e6;
  }

  // Put v in a free lane around the focus. Normal replenishment protects the near view; teleports can fill it.
  function spawnVehicle(v, rMin, rMax, protectView) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const e = nearEdges[Math.floor(Math.random() * nearEdges.length)];
      if (!e || (v.bus && !e.major) || e.len < 2 * v.half + 10) continue; // buses keep to major roads (road-network.js)
      const lane = Math.floor(Math.random() * e.lanes.length);
      const along = (focusX - e.sx) * e.dx + (focusZ - e.sz) * e.dz;
      const minS = Math.max(v.half + 5, along - rMax);
      const maxS = Math.min(e.len - v.half - 5, along + rMax);
      if (minS > maxS) continue;
      const s = minS + Math.random() * (maxS - minS);
      const x = e.sx + e.dx * s + e.rx * e.lanes[lane];
      const z = e.sz + e.dz * s + e.rz * e.lanes[lane];
      const d = Math.hypot(x - focusX, z - focusZ);
      if (d < rMin || d > rMax || (protectView && nearView(x, z, v.half + 4, VEHICLE_SPAWN_DISTANCE))) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < 25) continue;
      if (!laneClear(e.occ[lane], s, v.half + 8) || nearTram(x, z, v.half + 3)) continue;
      place(v, e, lane, s);
      return true;
    }
    return false;
  }

  // =========================================================================
  // 7. PEDESTRIANS
  // =========================================================================
  const KERB = 1.6; // how far along a crosswalk track pedestrians wait to cross (the curb is 2 m along)
  const pedRoutes = createPedestrianRoutes(network, blockAt, railClearance);
  // Decide demand-only crossings after the real walking routes are known: a dropped OSM arm can leave a road
  // stopping for nobody. Use the curb-to-curb walk, not crosswalk.span (the approach road's length), for clearance.
  function configureSignals() {
    const widths = new Map();
    for (const n of nodes) {
      if (!n.signal) continue;
      if (n.signalTiming.pedestrian || n.sideCount < 3) {
        const crossings = pedRoutes.across(n);
        let width = 0;
        for (const route of crossings) width = Math.max(width, route.len - 2 * KERB);
        configurePedestrianSignal(n, crossings.length > 0, width);
      } else {
        let width = widths.get(n.signalTiming);
        if (!width) widths.set(n.signalTiming, (width = [0, 0]));
        for (const route of pedRoutes.across(n)) {
          const group = route.group === 0 ? 1 : 0;
          width[group] = Math.max(width[group], route.len - 2 * KERB);
        }
      }
      if (n.paintNode) n.paintNode.signal = n.signal;
      if (n.signal) signalNodes.push(n);
    }
    configureSignalClearance(widths);
  }
  configureSignals();
  // Every junction with a crosswalk, signalised or not, where crossing pedestrians may start (refreshNear). At an
  // unsignalised one they always have the WALK and vehicles yield to them (walkOn, mayCross, pedestrianOn).
  const crossingNodes = nodes.filter((n) => pedRoutes.across(n).length > 0);
  const track = { ax: 0, az: 0, ux: 0, uz: 1, len: 1, node: null, side: 0, group: 0, line: 0, route: null };

  function sidewalkTrack(e) {
    const choices = pedRoutes.along(e);
    if (!choices.length) return false;
    const route = choices[Math.floor(Math.random() * choices.length)];
    Object.assign(track, route, { route });
    return true;
  }

  function crosswalkTrack(n) {
    const choices = pedRoutes.across(n);
    if (!choices.length) return false;
    const route = choices[Math.floor(Math.random() * choices.length)];
    Object.assign(track, route, { route });
    return true;
  }

  // Who is at (or just past) the curbs of each intersection's crosswalks, for whoever comes up behind to queue
  const QUEUE_GAP = 0.62; // m from one person standing in a queue to the next
  const curbNodes = [];
  const curbProgress = (p) => (p.dir > 0 ? p.t : p.len - p.t); // m along its way over (the curb it waits at is KERB)
  function atCurb(p) {
    const crossing = !p.node && p.nextRoute?.find((leg, i) => i >= p.nextLeg && leg.track.node);
    const n = p.node || crossing?.track.node;
    if (!n || (p.node && curbProgress(p) > KERB + 0.5) || n.curb.includes(p)) return;
    if (!n.curb.length) curbNodes.push(n);
    n.curb.push(p);
  }
  function gatherCurbs() {
    for (const n of curbNodes) n.curb.length = 0;
    curbNodes.length = 0;
    for (const p of peds) if (p.placed) atCurb(p);
  }

  // Try crosswalks first for crossing pedestrians, then fall back to sidewalks if no suitable crossing fits.
  function spawnPed(p, rMin, rMax, protectView) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const crosswalk = p.crossesStreets && nearCrossings.length > 0 && attempt < 5;
      const ok = crosswalk
        ? crosswalkTrack(nearCrossings[Math.floor(Math.random() * nearCrossings.length)])
        : nearEdges.length > 0 && sidewalkTrack(nearEdges[Math.floor(Math.random() * nearEdges.length)]);
      if (!ok) continue;
      const along = (focusX - track.ax) * track.ux + (focusZ - track.az) * track.uz;
      const minT = Math.max(0, along - rMax), maxT = Math.min(track.len, along + rMax);
      if (minT > maxT) continue;
      const t = crosswalk ? (Math.random() < 0.5 ? Math.random() * KERB : track.len - Math.random() * KERB) : minT + Math.random() * (maxT - minT);
      const x = track.ax + track.ux * t;
      const z = track.az + track.uz * t;
      const d = Math.hypot(x - focusX, z - focusZ);
      if (d < rMin || d > rMax || (protectView && nearView(x, z, 2, PED_SPAWN_DISTANCE))) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < 10) continue;
      if (crosswalk && track.node.curb.some((q) => Math.hypot(q.x - x, q.z - z) < QUEUE_GAP)) continue;
      // not waiting at a split crossing's strip end next to the rails (pedestrian-routes.js `cramped`)
      if (crosswalk && track.route && track.route.cramped && track.route.cramped[t < track.len * 0.5 ? 0 : 1]) continue;
      if (p.conversation) endConversation(p.conversation);
      Object.assign(p, track);
      p.t = t;
      p.dir = t < track.len * 0.5 ? 1 : -1;
      p.through = false;
      p.x = x;
      p.z = z;
      p.v = crosswalk ? 0 : p.speed;
      p.pause = 0;
      p.nextRoute = null;
      p.nextLeg = 0;
      p.goalTime = 0;
      p.restTime = clock + 25 + Math.random() * 45;
      p.socialTime = clock + 5 + Math.random() * 15;
      p.rig.placed = false; // stands afresh where it now is
      p.placed = true;
      if (crosswalk) atCurb(p);
      return true;
    }
    return false;
  }

  // Does p, on a crosswalk, have the WALK? Over group 0's road (the widest road at the junction)
  // with the other roads' traffic, over the others with group 0's. Without a signal always: people waiting at the curb
  // have priority, and vehicles yield to them through pedestrianOn as on the WALK.
  function walkOn(p) {
    if (!p.node.signal) return true;
    const timing = p.node.signalTiming;
    return timing.pedestrian || p.group === 0 ? timing.walk1 : timing.walk0;
  }

  // May p step off the curb onto its crosswalk? On the WALK (early in the parallel traffic's green, so red for the
  // traffic arriving over it), once no vehicle is crossing it or committed to, and none is too close to stop. Reads only
  // `node, side, group`, so a crosswalk track will do for p (the strip ends people hold at, walk()).
  function mayCross(p) {
    const n = p.node;
    if (!walkOn(p)) {
      // Repeated attempts preserve the first request's time. Only walkers at a curb (or a refuge hold) ask,
      // so a two-arm road stays green when no pedestrian actually wants to cross it.
      requestWalkSignal(clock, n);
      return false;
    }
    const sides = p.sides || p.route?.sides;
    for (let i = 0; i < (sides ? sides.length : 1); i++) {
      const side = sides ? sides[i].side : p.side;
      if (n.crossing[side] > 0) return false;
      const e = n.approach[side];
      if (!e) continue;
      for (const list of e.occ) {
        const lead = leadOf(list);
        if (lead && !canStop(lead, e, true)) return false;
      }
    }
    return true;
  }

  // Trams have priority over people crossing their track (on a crosswalk, or where a track cuts across a sidewalk):
  // each walking track lists where it crosses the tram tracks (worked out on first use), and p stops short of the
  // next one while a tram is over it or due there within PED_TRAM_TIME seconds. Anyone already on the rails walks on.
  const PED_TRAM_TIME = 6;
  function tramRoom(p) {
    const route = p.route;
    if (!route || !tramGraph || !trams.length) return Infinity;
    let crossings = route.tramCrossings;
    if (crossings === undefined) crossings = route.tramCrossings = tramCrossings(route);
    let room = Infinity;
    for (const c of crossings) {
      let before = (c.t - p.t) * p.dir - c.clear;
      if (before > 25 || before < -2 * c.clear || !tramNear(c.edge, c.s, PED_TRAM_TIME)) continue;
      // Short of a track inside the reach of another one (between the two tracks of a line, ~3 m apart) is no place
      // to wait: short of that one instead, or, already on it, walk on (two passes settle a pair in any order)
      for (let pass = 0; pass < 2; pass++) {
        for (const o of crossings) {
          const enter = (o.t - p.t) * p.dir - o.clear;
          if (enter < before && before < enter + 2 * o.clear) before = enter;
        }
      }
      if (before >= -0.3) room = Math.min(room, Math.max(0, before));
    }
    return room;
  }

  // Is p within a tram's reach of the rails its track crosses?
  function onRails(p) {
    const route = p.route;
    if (!route || !tramGraph) return false;
    let crossings = route.tramCrossings;
    if (crossings === undefined) crossings = route.tramCrossings = tramCrossings(route);
    for (const c of crossings) if (Math.abs(c.t - p.t) < c.clear) return true;
    return false;
  }

  // Where a walking track (a, along u for len) crosses the tram tracks: [{ t (m along it), edge, s (along that tram
  // edge), clear (m along the track the tram's body reaches out to either side of the rails) }]. One direction per
  // track: tramNear checks both.
  function tramCrossings(route) {
    const out = [];
    const { ax, az, ux, uz, len } = route;
    const bx = ax + ux * len;
    const bz = az + uz * len;
    for (const e of tramGraph.edges) {
      if (e.flip && e.reverse) continue;
      if (e.box[0] > Math.max(ax, bx) + 1 || e.box[1] < Math.min(ax, bx) - 1 || e.box[2] > Math.max(az, bz) + 1 || e.box[3] < Math.min(az, bz) - 1) continue;
      const P = e.pts;
      for (let i = 0; i + 1 < e.cum.length; i++) {
        const qx = P[2 * i], qz = P[2 * i + 1];
        const vx = P[2 * i + 2] - qx, vz = P[2 * i + 3] - qz;
        const den = ux * vz - uz * vx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((qx - ax) * vz - (qz - az) * vx) / den;
        const k = ((qx - ax) * uz - (qz - az) * ux) / den;
        if (t < 0 || t > len || k < 0 || k > 1) continue;
        const sin = Math.abs(den) / Math.hypot(vx, vz);
        // The tram checks a world-aligned pedestrian square: its diagonal reach is 0.71 m, plus the 1.2 m
        // half-body and 0.05 m safety margin. Waiting 1.8 m away still blocked diagonal trams, so people on two
        // adjacent tracks could wait for each other's tram forever. Keep 2 m normal clearance at any angle.
        out.push({ t, edge: e, s: e.cum[i] + k * (e.cum[i + 1] - e.cum[i]), clear: 2.0 / sin });
      }
    }
    return out;
  }

  // Is a tram's body over point s of tram edge te (either way along that track), or its front due there within
  // `time` seconds (unless it stands waiting for pedestrians)?
  function tramNear(te, s, time) {
    for (const t of trams) {
      const path = t.path;
      for (let i = 0; i < path.n; i++) {
        const e = path.edges[i];
        const at = e === te ? s : e === te.reverse ? te.len - s : -1;
        if (at < 0) continue;
        const d = path.start[i] + at - path.u;
        // a tram standing short of the crossing for the people in its way lets them cross: waiting for it there
        // locked both up for good (trams held 90 s by someone 2 m off their front, then respawned)
        if (d > 0 && t.speed < 0.5 && t.waitReason === 'pedestrian') continue;
        if (d > -t.length - 1.5 && d < 3 + t.speed * time) return true;
      }
    }
    return false;
  }

  // Continue through validated sidewalk corners. Crossing tracks retain their curb queues and right of way;
  // only a dead end needs a turnaround. Goals guide local choices without a city-wide path search.
  const PED_ACCEL = 1.3; // m/s^2 setting off
  const PED_BRAKE = 1.6; // m/s^2 easing to a stop
  const TURN_TIME = 0.85; // s turning round at the end of the track
  const walkedNodes = [];
  function walk(p, dt) {
    if (p.pause > 0) p.pause = Math.max(0, p.pause - dt);
    const ahead = p.dir > 0 ? p.len - p.t : p.t;
    if (clock >= p.goalTime || Math.hypot(p.x - p.goalX, p.z - p.goalZ) < 25) {
      const destination = nearEdges[Math.floor(Math.random() * nearEdges.length)];
      p.goalX = destination ? destination.sx + destination.dx * destination.len * 0.5 : p.x;
      p.goalZ = destination ? destination.sz + destination.dz * destination.len * 0.5 : p.z;
      p.goalTime = clock + 120 + Math.random() * 180;
    }
    if (!p.nextRoute && p.route && ahead < 4) {
      p.nextRoute = pedRoutes.next(p.route, p.dir, p.goalX, p.goalZ);
      p.nextLeg = 0;
      if (!p.node && p.nextRoute) atCurb(p);
    }
    if (!p.node && p.route?.edge && p.t > 6 && p.t < p.len - 6 && clock >= p.restTime) {
      p.pause = 1.5 + Math.random() * 3;
      p.restTime = clock + 35 + Math.random() * 55;
    }
    let vMax = p.pause > 0 || p.conversation ? 0 : p.speed;
    if (!p.nextRoute) vMax = Math.min(vMax, Math.sqrt(2 * PED_BRAKE * ahead));
    let room = Infinity;
    if (!p.node && p.nextRoute && !onRails(p)) {
      // A queue can reach back onto the sidewalk. Keep clear before entering its track, including short corner
      // segments; actual separation matters where the approach meets the crossing at an angle. Not on the rails
      // (a split crossing's walk over a tram strip, its queue full): there p closes up rather than stand in a tram's way.
      const crossing = p.nextRoute.find((leg, i) => i >= p.nextLeg && leg.track.node);
      if (crossing) {
        const entranceX = crossing.track.ax + (crossing.dir < 0 ? crossing.track.ux * crossing.track.len : 0);
        const entranceZ = crossing.track.az + (crossing.dir < 0 ? crossing.track.uz * crossing.track.len : 0);
        let leader = null, nearest = Infinity;
        for (const q of crossing.track.node.curb) {
          const next = !q.node && q.nextRoute?.find((leg, i) => i >= q.nextLeg && leg.track.node);
          const queued = q.node ? q : next?.track;
          if (!queued || queued.node !== crossing.track.node || queued.side !== crossing.track.side || (q.node ? q.dir : next.dir) !== crossing.dir || Math.abs(queued.line - crossing.track.line) > 0.55) continue;
          const distance = Math.hypot(q.x - entranceX, q.z - entranceZ);
          if (!q.node && distance < nearest) { leader = q; nearest = distance; }
          if (q === p) continue;
          const dx = q.x - p.x, dz = q.z - p.z;
          const forward = (dx * p.ux + dz * p.uz) * p.dir;
          const lateral2 = Math.max(0, dx * dx + dz * dz - forward * forward);
          if (forward >= 0 && lateral2 < QUEUE_GAP * QUEUE_GAP) {
            room = Math.min(room, Math.max(0, forward - Math.sqrt(QUEUE_GAP * QUEUE_GAP - lateral2)));
          }
        }
        if (leader && leader !== p) {
          // The closest arrival merges first. Keep other approaches outside its remaining walking lines,
          // so perpendicular queues cannot trap each other at the entrance after WALK turns green.
          const yieldToLine = (line) => {
            const side = (p.x - line.ax) * line.uz - (p.z - line.az) * line.ux;
            const toward = (p.ux * line.uz - p.uz * line.ux) * p.dir;
            if (side * toward < 0) room = Math.min(room, Math.max(0, (Math.abs(side) - QUEUE_GAP - 0.01) / Math.abs(toward)));
          };
          yieldToLine(leader);
          for (let i = leader.nextLeg; i < leader.nextRoute.length; i++) {
            yieldToLine(leader.nextRoute[i].track);
            if (leader.nextRoute[i].track.node) break;
          }
        }
      }
    }
    if (p.node) {
      // room to walk before standing: up to the curb unless p may cross (or crosses on from a strip with no room to
      // wait), and up to the back of whoever is ahead
      const s = curbProgress(p);
      room = s <= KERB && !p.through && !mayCross(p) ? KERB - s : Infinity;
      for (const q of p.node.curb) {
        if (q === p || q.node !== p.node || q.side !== p.side || q.dir !== p.dir || Math.abs(q.line - p.line) > 0.55) continue;
        const gap = curbProgress(q) - s;
        if (gap > 0) room = Math.min(room, Math.max(0, gap - QUEUE_GAP));
      }
    }
    // At a split crossing's strip end whose far end has no room to wait (next to the rails: pedestrian-routes.js
    // `hold`), wait here, short of the tracks, until the crosswalk over the far roadway may be crossed
    const hold = p.nextRoute && p.nextLeg < p.nextRoute.length ? p.nextRoute[p.nextLeg].hold : null;
    const held = !!hold && !mayCross(hold);
    if (held) room = Math.min(room, ahead);
    room = Math.min(room, tramRoom(p));
    vMax = Math.min(vMax, Math.sqrt(2 * PED_BRAKE * room));
    p.v += Math.max(-2 * PED_BRAKE * dt, Math.min(PED_ACCEL * dt, vMax - p.v));
    const movement = Math.min(p.v * dt, room);
    if (p.v * dt > room) p.v = 0;
    let t = p.t + p.dir * movement;
    const reachesCurb = !!p.node && curbProgress(p) <= KERB && (p.dir > 0 ? t : p.len - t) >= KERB - 1e-6;
    p.waiting = reachesCurb && !p.through && !mayCross(p);
    if (p.waiting) {
      t = p.dir > 0 ? Math.min(t, KERB) : Math.max(t, p.len - KERB);
      p.v = 0;
    }
    if ((p.dir > 0 ? t >= p.len : t <= 0) && !held) {
      t = p.dir > 0 ? p.len : 0;
      if (p.nextRoute) {
        const leg = p.nextRoute[p.nextLeg++];
        // committed from the hold over the strip and the far roadway; done once off a crosswalk
        p.through = !!leg.hold || (p.through && !p.node);
        Object.assign(p, leg.track);
        p.route = leg.track;
        p.dir = leg.dir;
        t = p.dir > 0 ? 0 : p.len;
        p.t = t;
        if (p.node) atCurb(p); // later arrivals this frame must see the newly occupied entrance
        if (p.nextLeg === p.nextRoute.length) p.nextRoute = null;
      } else {
        p.dir = -p.dir;
        p.v = 0;
        p.pause = TURN_TIME;
        p.through = false;
      }
    }
    p.t = t;
    p.x = p.ax + p.ux * t;
    p.z = p.az + p.uz * t;
    if (p.node && ((t > KERB && t < p.len - KERB) || (p.waiting && walkOn(p)))) {
      p.coord = p.x * p.ux + p.z * p.uz; // along the crosswalk, on laneCoord's scale
      if (!p.node.walkers.length) walkedNodes.push(p.node);
      p.node.walkers.push(p);
    }
  }

  function endConversation(conversation) {
    for (const p of [conversation.a, conversation.b]) {
      p.conversation = null;
      p.socialTime = clock + 30 + Math.random() * 60;
    }
    conversation.remaining = 0;
  }

  const meetingCells = new Map();
  let nextMeeting = 0;
  function meet(dt) {
    for (const p of peds) {
      const conversation = p.conversation;
      if (!conversation || conversation.a !== p) continue;
      conversation.remaining -= dt;
      if (conversation.remaining <= 0) endConversation(conversation);
    }
    if (clock < nextMeeting) return;
    nextMeeting = clock + 1;
    meetingCells.clear();
    for (const p of peds) {
      if (!p.placed || p.node || !p.route?.edge || p.conversation || clock < p.socialTime || p.t < 6 || p.t > p.len - 6) continue;
      const ix = Math.floor(p.x / 2), iz = Math.floor(p.z / 2);
      let partner = null;
      for (let dx = -1; dx <= 1 && !partner; dx++) {
        for (let dz = -1; dz <= 1 && !partner; dz++) {
          for (const q of meetingCells.get(`${ix + dx}:${iz + dz}`) || []) {
            const distance = Math.hypot(p.x - q.x, p.z - q.z);
            if (q.conversation || p.route.block !== q.route.block || distance < 0.75 || distance > 2 || Math.random() > 0.15) continue;
            partner = q;
            break;
          }
        }
      }
      if (partner) {
        p.conversation = partner.conversation = { a: p, b: partner, remaining: 6 + Math.random() * 6 };
        p.v = partner.v = 0;
      } else {
        const key = `${ix}:${iz}`;
        if (!meetingCells.has(key)) meetingCells.set(key, []);
        meetingCells.get(key).push(p);
      }
    }
  }

  // =========================================================================
  // 8. RENDERING
  // =========================================================================
  // Beyond CAR_PROXY_DISTANCE, cars use the ~250-triangle stand-in with built-in wheels instead of the full lofted
  // body + 4 separate wheel instances; vehicles outside the view frustum (with a margin for cast shadows and headlight
  // cones) are skipped altogether.
  const CAR_PROXY_DISTANCE = 90;
  const dirtyPaint = new Set();
  const dirtyState = new Set();
  const litVehicles = [];
  let litVehicleCount = 0;
  let wheelCars = 0;
  let visibleCars = 0;
  let visibleBuses = 0;
  let visibleBuses18 = 0;
  let updates = 0;

  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }

  // 3D spinning alloy wheels & tires for a single axle at local offset (halfTrack, wz), exact 1:1 ground rolling
  function placeAxle(v, slot, rotY, roll, radius, halfTrack, wz, steer, leftInst, rightInst, baseRadius = 0.35, phase = 0) {
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const scale = radius / baseRadius;
    dummy.scale.set(scale, scale, scale);

    dummy.rotation.set(v.wheelSpin + phase, rotY + steer, roll, 'YXZ');
    dummy.position.set(v.x - halfTrack * cosY + wz * sinY, radius, v.z + halfTrack * sinY + wz * cosY);
    dummy.updateMatrix();
    leftInst.setMatrixAt(slot, dummy.matrix);

    dummy.position.set(v.x + halfTrack * cosY + wz * sinY, radius, v.z - halfTrack * sinY + wz * cosY);
    dummy.updateMatrix();
    rightInst.setMatrixAt(slot, dummy.matrix);
  }

  // 3D spinning alloy wheels & tires (left & right, front & rear), exact 1:1 ground rolling, steering front wheels.
  // The wheel geometry is modelled at baseRadius (WHEEL_SPEC's car wheel), scaled to the vehicle's radius
  function placeWheels(v, i, rotY, roll, radius, halfTrack, halfBase, leftInst, rightInst, baseRadius = 0.35) {
    placeAxle(v, i * 2, rotY, roll, radius, halfTrack, halfBase, v.steer || 0, leftInst, rightInst, baseRadius, 0);
    placeAxle(v, i * 2 + 1, rotY, roll, radius, halfTrack, -halfBase, 0, leftInst, rightInst, baseRadius, 0.55);
  }

  // Lamp state for the car & bus materials: brake lights while slowing down or standing, the turn signal on the side
  // v is heading for (left = +x)
  function writeLampState(v, array, o) {
    const blinkOn = v.blink !== 0 && (clock + v.blinkPhase) % 0.8 <= 0.4;
    array[o] = v.acc < -0.8 || v.speed < 0.3 ? 1 : 0;
    array[o + 1] = blinkOn && v.blink < 0 ? 1 : 0;
    array[o + 2] = blinkOn && v.blink > 0 ? 1 : 0;
  }

  function renderCar(c) {
    const rotY = c.yaw + c.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const spec = BODY_SPECS[c.bodyType];
    const forwardDist = (c.x - c.prevX) * sinY + (c.z - c.prevZ) * cosY;
    const rawStep = forwardDist / spec.wheelRadius;
    c.wheelSpin = (c.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
    if (hasView && !visible(c.x, c.z, 18)) return;

    const near = Math.hypot(c.x - focusX, c.z - focusZ) < CAR_PROXY_DISTANCE;
    const bodyInst = near ? bodies[c.bodyType].near : bodies[c.bodyType].far;
    const slot = bodyInst.count++;

    dummy.position.set(c.x, 0.0, c.z);
    dummy.rotation.set(c.pitch, rotY, c.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(slot, dummy.matrix);
    if (c.livery) {
      const bar = lightbars[c.bodyType];
      bar.inst.setMatrixAt(bar.drawn++, dummy.matrix);
    }

    // Paint and registration only change when the slot goes to another car (both flagged through dirtyPaint)
    const attrs = bodyInst.geometry.attributes;
    const paint = attrs.paintColor.array;
    const plate = attrs.plateCode.array;
    const o3 = slot * 3;
    const o4 = slot * 4;
    if (paint[o3] !== c.paint[0] || paint[o3 + 1] !== c.paint[1] || paint[o3 + 2] !== c.paint[2] ||
      plate[o4] !== c.plate[0] || plate[o4 + 1] !== c.plate[1] || plate[o4 + 2] !== c.plate[2] || plate[o4 + 3] !== c.plate[3]) {
      paint[o3] = c.paint[0];
      paint[o3 + 1] = c.paint[1];
      paint[o3 + 2] = c.paint[2];
      plate[o4] = c.plate[0];
      plate[o4 + 1] = c.plate[1];
      plate[o4 + 2] = c.plate[2];
      plate[o4 + 3] = c.plate[3];
      dirtyPaint.add(bodyInst);
    }
    const state = attrs.carState.array;
    const blinkOn = c.blink !== 0 && (clock + c.blinkPhase) % 0.8 <= 0.4;
    const b0 = c.acc < -0.8 || c.speed < 0.3 ? 1 : 0;
    const b1 = blinkOn && c.blink < 0 ? 1 : 0;
    const b2 = blinkOn && c.blink > 0 ? 1 : 0;
    const b3 = c.livery;
    if (state[o4] !== b0 || state[o4 + 1] !== b1 || state[o4 + 2] !== b2 || state[o4 + 3] !== b3) {
      state[o4] = b0;
      state[o4 + 1] = b1;
      state[o4 + 2] = b2;
      state[o4 + 3] = b3;
      dirtyState.add(bodyInst);
    }

    // Soft Under-Car Contact Shadow (AO) stays flat on the asphalt
    const visIdx = visibleCars++;
    dummy.rotation.set(0, rotY, 0, 'YXZ');
    dummy.position.set(c.x, 0.018, c.z);
    dummy.scale.set(c.shadowW, 1.0, c.shadowL);
    dummy.updateMatrix();
    carShadowInst.setMatrixAt(visIdx, dummy.matrix);

    const dxCam = c.x - camX;
    const dzCam = c.z - camZ;
    const distSq = dxCam * dxCam + dzCam * dzCam + camY * camY;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        c._camDistSq = distSq;
        c._effDist = effDist;
        c._sinY = sinY;
        c._cosY = cosY;
        c._braking = b0;
        litVehicles[litVehicleCount++] = c;
      }
    }

    if (near) {
      placeWheels(c, wheelCars++, rotY, c.roll, spec.wheelRadius, spec.wheelX, spec.wheelZ, carWheelLeftInst, carWheelRightInst,
        WHEEL_SPEC.wheelRadius);
    }
  }

  // 18 m articulated bus pusher kinematics: trailer axle follows Section A rear hitch point
  function updateBusTrailer(b, rotY) {
    const halfA = 5.2;
    const halfB = 3.4;
    const L_B = 4.3;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const jx = b.x - sinY * halfA;
    const jz = b.z - cosY * halfA;

    let trailer = b.trailer;
    if (!trailer) {
      trailer = b.trailer = {
        x: jx - sinY * halfB,
        z: jz - cosY * halfB,
        prevX: jx - sinY * halfB,
        prevZ: jz - cosY * halfB,
        yaw: rotY,
        axleX: jx - sinY * L_B,
        axleZ: jz - cosY * L_B,
        lastJx: jx,
        lastJz: jz,
        wheelSpin: b.wheelSpin,
        placed: true
      };
    }

    const jumpDistSq = (jx - trailer.lastJx) * (jx - trailer.lastJx) + (jz - trailer.lastJz) * (jz - trailer.lastJz);
    if (jumpDistSq > 16.0 || !trailer.placed) {
      trailer.yaw = rotY;
      trailer.axleX = jx - sinY * L_B;
      trailer.axleZ = jz - cosY * L_B;
      trailer.x = jx - sinY * halfB;
      trailer.z = jz - cosY * halfB;
      trailer.placed = true;
    } else {
      const dx = jx - trailer.axleX;
      const dz = jz - trailer.axleZ;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        trailer.yaw = Math.atan2(dx, dz);
        const sinB = Math.sin(trailer.yaw);
        const cosB = Math.cos(trailer.yaw);
        trailer.axleX = jx - sinB * L_B;
        trailer.axleZ = jz - cosB * L_B;
        trailer.x = jx - sinB * halfB;
        trailer.z = jz - cosB * halfB;
      }
    }
    trailer.lastJx = jx;
    trailer.lastJz = jz;

    const forwardDistB = (trailer.x - (trailer.prevX ?? trailer.x)) * Math.sin(trailer.yaw) +
                         (trailer.z - (trailer.prevZ ?? trailer.z)) * Math.cos(trailer.yaw);
    const rawStepB = forwardDistB / BUS_SPEC.wheelRadius;
    trailer.wheelSpin = ((trailer.wheelSpin || 0) + Math.sign(rawStepB) * Math.min(Math.abs(rawStepB), 0.48)) % (Math.PI * 2);
    trailer.prevX = trailer.x;
    trailer.prevZ = trailer.z;
    return trailer;
  }

  function renderBus(b) {
    const rotY = b.yaw + b.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const forwardDist = (b.x - b.prevX) * sinY + (b.z - b.prevZ) * cosY;
    const rawStep = forwardDist / BUS_SPEC.wheelRadius;
    b.wheelSpin = (b.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);

    const checkR = b.articulated ? 28 : 22;
    if (hasView && !visible(b.x, b.z, checkR)) return;

    if (b.articulated) {
      const trailer = b.trailer || updateBusTrailer(b, rotY);
      const halfA = 5.2;
      const jx = b.x - sinY * halfA;
      const jz = b.z - cosY * halfA;

      const i18 = visibleBuses18++;

      // Section A shadow
      dummy.position.set(b.x, 0.018, b.z);
      dummy.rotation.set(0, rotY, 0, 'YXZ');
      dummy.scale.set(2.92, 1.0, 10.6);
      dummy.updateMatrix();
      bus18ShadowInst.setMatrixAt(i18 * 2, dummy.matrix);

      // Section B shadow
      dummy.position.set(trailer.x, 0.018, trailer.z);
      dummy.rotation.set(0, trailer.yaw, 0, 'YXZ');
      dummy.scale.set(2.92, 1.0, 7.2);
      dummy.updateMatrix();
      bus18ShadowInst.setMatrixAt(i18 * 2 + 1, dummy.matrix);

      // Section A body
      dummy.position.set(b.x, 0.0, b.z);
      dummy.rotation.set(b.pitch, rotY, b.roll, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bus18FrontInst.setMatrixAt(i18, dummy.matrix);
      bus18SignInst.setMatrixAt(i18, dummy.matrix);

      // Section B body
      dummy.position.set(trailer.x, 0.0, trailer.z);
      dummy.rotation.set(b.pitch, trailer.yaw, b.roll, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bus18RearInst.setMatrixAt(i18, dummy.matrix);

      // Articulation bellows
      const dh = Math.atan2(Math.sin(trailer.yaw - rotY), Math.cos(trailer.yaw - rotY));
      const jYaw = rotY + dh * 0.5;
      dummy.position.set(jx, 0.0, jz);
      dummy.rotation.set(b.pitch, jYaw, b.roll, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bus18BellowsInst.setMatrixAt(i18, dummy.matrix);

      writeLampState(b, bus18States.array, i18 * 4);
      bus18States.array[i18 * 4 + 3] = b.route;

      // Wheels: Section A front axle (z = 2.45), Section A mid axle (z = -3.45), Section B rear axle (z = -0.85)
      placeAxle(b, i18 * 3, rotY, 0, BUS_18_SPEC.front.wheelRadius, BUS_18_SPEC.front.wheelX, BUS_18_SPEC.front.wheelZFront, b.steer || 0, bus18WheelLeftInst, bus18WheelRightInst, BUS_18_SPEC.front.wheelRadius, 0);
      placeAxle(b, i18 * 3 + 1, rotY, 0, BUS_18_SPEC.front.wheelRadius, BUS_18_SPEC.front.wheelX, BUS_18_SPEC.front.wheelZMid, 0, bus18WheelLeftInst, bus18WheelRightInst, BUS_18_SPEC.front.wheelRadius, 0.55);
      placeAxle(trailer, i18 * 3 + 2, trailer.yaw, 0, BUS_18_SPEC.rear.wheelRadius, BUS_18_SPEC.rear.wheelX, BUS_18_SPEC.rear.wheelZRear, 0, bus18WheelLeftInst, bus18WheelRightInst, BUS_18_SPEC.rear.wheelRadius, 1.10);

    } else {
      const i = visibleBuses++;
      dummy.position.set(b.x, 0.018, b.z);
      dummy.rotation.set(0, rotY, 0, 'YXZ');
      dummy.scale.set(2.92, 1.0, 12.1);
      dummy.updateMatrix();
      busShadowInst.setMatrixAt(i, dummy.matrix);

      // Lofted Bus Body is defined in ground-relative Y (0.36m skirt to 3.0m roof crown)
      dummy.position.set(b.x, 0.0, b.z);
      dummy.rotation.set(b.pitch, rotY, b.roll, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      busBodyInst.setMatrixAt(i, dummy.matrix);
      busHeaderInst.setMatrixAt(i, dummy.matrix);
      writeLampState(b, busStates.array, i * 4);
      busStates.array[i * 4 + 3] = b.route;

      placeWheels(b, i, rotY, 0, BUS_SPEC.wheelRadius, BUS_SPEC.wheelX, BUS_SPEC.wheelZ, busWheelLeftInst, busWheelRightInst, BUS_SPEC.wheelRadius);
    }

    const dxCam = b.x - camX;
    const dzCam = b.z - camZ;
    const distSq = dxCam * dxCam + dzCam * dzCam + camY * camY;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        b._camDistSq = distSq;
        b._effDist = effDist;
        b._sinY = sinY;
        b._cosY = cosY;
        b._braking = b.acc < -0.8 || b.speed < 0.3 ? 1 : 0;
        litVehicles[litVehicleCount++] = b;
      }
    }
  }

  function smoothDistFade(d, start, end) {
    const t = clamp((end - d) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function updateTrafficLights() {
    litVehicles.length = litVehicleCount;
    if (litVehicleCount > 1) {
      litVehicles.sort((a, b) => a._effDist - b._effDist);
    }

    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    // Front headlights are off during Midday (0.24) & Golden Hour (0.48); fade in smoothly for Dusk (1.25) & Night (1.55)
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const tailScale = clamp(0.18 + glow * 0.66, 0.24, 1.22);

    const maxDualVehicles = HEADLIGHT_POOL_SIZE >> 1;
    const vehCutoff = litVehicleCount > maxDualVehicles
      ? Math.min(MAX_LIGHT_DIST, litVehicles[maxDualVehicles]._effDist)
      : MAX_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < litVehicleCount && spotUsed + 2 <= HEADLIGHT_POOL_SIZE; i++) {
        const v = litVehicles[i];
        const fade = smoothDistFade(v._effDist, vehCutoff * 0.62, vehCutoff);
        if (fade <= 0.001) continue;
        const spec = v.bus ? (v.articulated ? BUS_18_SPEC.front : BUS_SPEC) : BODY_SPECS[v.bodyType];
        const fullReach = HEADLIGHTS.distance;
        let maxReach = fullReach;
        if (player.active && v.pAhead > 0 && v.pAhead < 30) {
          const latWeight = smoothDistFade(Math.abs(v.pRight), 2.2, 5.5);
          const clampedReach = Math.max(4.5, v.pAhead - player.halfL - 1.5);
          maxReach = fullReach + (clampedReach - fullReach) * latWeight;
        }

        const baseInt = (v.bus ? HEADLIGHTS.busIntensity : HEADLIGHTS.intensity) * beamScale * fade;
        // Match the body instance, including suspension and impact rotation.
        dummy.position.set(v.x, 0, v.z);
        dummy.rotation.set(v.pitch, v.yaw + v.yawOffset, v.roll, 'YXZ');
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        for (let side = -1; side <= 1; side += 2) {
          const spot = headlightPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, dummy.matrix);
          spot.distance = maxReach;
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HEADLIGHT_POOL_SIZE; i++) {
      const spot = headlightPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }

    // 1. Emergency roof light bar flashes (blue 360° PointLights pulsing from side to side on nearby emergency
    // vehicles, above the bar, at the bar's place along the body: barY, barZ)
    let policeLightsUsed = 0;
    for (let i = 0; i < litVehicleCount && policeLightsUsed < POLICE_LIGHT_POOL_SIZE; i++) {
      const v = litVehicles[i];
      if (!v.isPolice || v._effDist >= 88) continue;
      const fade = smoothDistFade(v._effDist, 52, 88);
      if (fade <= 0.001) continue;
      const wave = Math.sin((clock + v.blinkPhase) * Math.PI * 6.0);
      const pulse = 0.35 + 0.65 * Math.abs(wave);
      const side = wave >= 0 ? -0.36 : 0.36;
      const pt = policeLightPool[policeLightsUsed++];
      pt.position.set(v.x + side * v._cosY + v.barZ * v._sinY, v.barY, v.z - side * v._sinY + v.barZ * v._cosY);
      pt.distance = 12.0;
      pt.intensity = 42.0 * tailScale * fade * pulse;
    }
    for (let i = policeLightsUsed; i < POLICE_LIGHT_POOL_SIZE; i++) {
      const pt = policeLightPool[i];
      pt.intensity = 0;
      pt.position.set(0, -1000, 0);
    }
  }

  // Walking surface around a pedestrian: sidewalks are 0.22 m above the road, and crosswalk tracks start and end
  // with 2 m of sidewalk (the rig steps down and up the curbs)
  const SIDEWALK_Y = 0.22;
  const CROSSWALK_Y = 0.012;
  function pedGround(p, x, z) {
    if (!p.node) return SIDEWALK_Y;
    const t = (x - p.ax) * p.ux + (z - p.az) * p.uz;
    return t > 2 && t < p.len - 2 ? CROSSWALK_Y : SIDEWALK_Y;
  }

  // Every rig's gait advances every frame; only those the camera may see (or whose shadow it may see) solve their
  // bone transforms and are drawn, the far ones with the light LOD.
  function renderPed(p, dt) {
    const draw = !hasView || visible(p.x, p.z, 7);
    const partner = p.conversation && (p.conversation.a === p ? p.conversation.b : p.conversation.a);
    const heading = partner ? Math.atan2(partner.x - p.x, partner.z - p.z) : Math.atan2(p.ux * p.dir, p.uz * p.dir);
    p.rig.update(dt, p.x, p.z, heading, pedGround, p, 0, draw);
    if (!draw) return;
    pedCrowd.add(p.rig, Math.hypot(p.x - focusX, p.z - focusZ));
  }

  function updateSparks(dt) {
    let count = 0;
    for (let s = 0; s < MAX_SPARKS; s++) {
      const sp = sparks[s];
      if (sp.life > 0) {
        sp.life -= dt;
        sp.vy -= 22.0 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.z += sp.vz * dt;
        if (sp.y < 0.03) {
          sp.y = 0.03;
          sp.vy = Math.abs(sp.vy) * 0.45;
          sp.vx *= 0.78;
          sp.vz *= 0.78;
        }
        const tLife = Math.max(0, sp.life / sp.maxLife);
        const spdXZ = Math.hypot(sp.vx, sp.vz) || 0.001;
        const yawSp = Math.atan2(sp.vx, sp.vz);
        const pitchSp = -Math.atan2(sp.vy, spdXZ);
        dummy.position.set(sp.x, sp.y, sp.z);
        dummy.rotation.set(pitchSp, yawSp, 0, 'YXZ');
        dummy.scale.set(tLife, tLife, Math.max(0.4, Math.min(2.2, spdXZ * 0.16)) * tLife);
        dummy.updateMatrix();
        sparkInst.setMatrixAt(count++, dummy.matrix);
      }
    }
    // Keep one degenerate instance for shader warm-up, then hide the empty pool and stop uploading it.
    sparkInst.visible = count > 0 || updates <= 2;
    if (count === 0 && updates <= 2) sparkInst.setMatrixAt(count++, zero);
    sparkInst.count = count;
    if (count > 0) flagRange(sparkInst.instanceMatrix, count);
  }

  // =========================================================================
  // 9. UPDATE
  // =========================================================================
  let lastFocusX = Infinity;
  let lastFocusZ = Infinity;
  let vehicleCursor = 0;
  let pedCursor = 0;

  function update(dt, elapsed, focusPos = null, playerEntity = null, activeMode = 'car', camera = null) {
    clock = elapsed;
    updateSignals(elapsed);
    focusX = focusPos ? focusPos.x : 0;
    focusZ = focusPos ? focusPos.z : 140;
    // a jump of the camera (teleport, first frame): everything far away can be placed anywhere around it
    const jump = Math.hypot(focusX - lastFocusX, focusZ - lastFocusZ) > 140;
    lastFocusX = focusX;
    lastFocusZ = focusZ;
    refreshNear();
    updateView(camera);

    player.active = Boolean(playerEntity && activeMode !== 'helicopter' && playerEntity.position.y < 2.6);
    if (playerEntity) {
      const heading = playerEntity.heading || 0;
      const speed = playerEntity.speed || 0;
      player.entity = playerEntity;
      player.x = playerEntity.position.x;
      player.z = playerEntity.position.z;
      player.vx = Math.sin(heading) * speed + (playerEntity.vx || 0);
      player.vz = Math.cos(heading) * speed + (playerEntity.vz || 0);
    }
    player.halfW = activeMode === 'cyclist' ? 0.35 : activeMode === 'person' ? 0.32 : 0.86;
    player.halfL = activeMode === 'cyclist' ? 0.85 : activeMode === 'person' ? 0.32 : 2.23;
    player.push = activeMode === 'cyclist' ? 0.82 : activeMode === 'person' ? 0.88 : 0.50;

    // 1. Cars & buses
    // Limit attempted placements, not just successes, and rotate through the pool so an awkward location
    // cannot monopolize a frame. Previous-frame lane lists protect spawn spacing; rebuild before driving.
    // Only as many drive as the lanes around the focus carry at VEHICLE_DENSITY: the rest are parked (no edge) as
    // they leave, and placed again when more road comes into reach. Reserve the pool's proportional bus share
    // (2 at the minimum population): cars used to fill the target before any bus received a placement attempt.
    // Blocked bus placements leave their slots free until safe, rather than relaxing spacing or view protection.
    let active = 0;
    let activeBuses = 0;
    const carTarget = nearTarget - nearBusTarget;
    for (const v of vehicles) if (v.edge) {
      active++;
      if (v.bus) activeBuses++;
    }
    for (let i = 0; jump && i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.edge && (v.bus ? activeBuses > nearBusTarget : active - activeBuses > carTarget)) {
        park(v);
        active--;
        if (v.bus) activeBuses--;
      }
    }
    let budget = jump ? vehicles.length : 4;
    for (let scanned = 0; scanned < vehicles.length && budget > 0; scanned++) {
      const v = vehicles[vehicleCursor];
      vehicleCursor = (vehicleCursor + 1) % vehicles.length;
      const d = v.edge ? Math.hypot(v.x - focusX, v.z - focusZ) : Infinity;
      if (d <= (jump ? NEAR_RADIUS : VEHICLE_RADIUS)) continue;
      budget--;
      if (v.edge) {
        park(v);
        active--;
        if (v.bus) activeBuses--;
      }
      const room = v.bus ? activeBuses < nearBusTarget : active - activeBuses < carTarget;
      if (active < nearTarget && room && spawnVehicle(v, jump ? 0 : 100, NEAR_RADIUS, !jump)) {
        active++;
        if (v.bus) activeBuses++;
      }
    }
    buildOccupancy();
    for (const m of bodyMeshes) m.count = 0;
    litVehicleCount = 0;
    wheelCars = 0;
    visibleCars = 0;
    for (const bar of lightbarList) bar.drawn = 0;
    visibleBuses = 0;
    visibleBuses18 = 0;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.edge) continue;

      v.prevX = v.x;
      v.prevZ = v.z;
      relateToPlayer(v);
      drive(v, dt);
      locate(v);
      knock(v, dt);
      pose(v, dt);
      if (v.bus && v.articulated) updateBusTrailer(v, v.yaw + v.yawOffset);
      if (player.active) {
        if (v.bus && v.articulated && v.trailer) {
          collideWithPlayer(v, v.yaw + v.yawOffset, 1.30, 5.2);
          collideWithPlayer(v, v.trailer.yaw, 1.30, 3.4, v.trailer.x, v.trailer.z);
        } else {
          collideWithPlayer(v, v.yaw + v.yawOffset, v.bus ? 1.30 : v.hitW, v.bus ? 5.72 : v.hitL);
        }
      }
      if (v.vx * v.vx + v.vz * v.vz > 0.36) knockOn(v);

      if (v.bus) renderBus(v);
      else renderCar(v);
    }
    if (player.active) for (const t of trams) collideWithTram(t);
    const hideEmpty = ++updates > 2;
    for (const m of bodyMeshes) {
      const n = m.count;
      m.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          m.setMatrixAt(0, zero);
          m.count = 1;
          flagRange(m.instanceMatrix, 1);
        }
        continue;
      }
      flagRange(m.instanceMatrix, n);
      if (dirtyPaint.has(m)) {
        flagRange(m.geometry.attributes.paintColor, n);
        flagRange(m.geometry.attributes.plateCode, n);
      }
      if (dirtyState.has(m)) flagRange(m.geometry.attributes.carState, n);
    }
    dirtyPaint.clear();
    dirtyState.clear();
    const syncInst = (inst, n) => {
      inst.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          inst.setMatrixAt(0, zero);
          inst.count = 1;
          flagRange(inst.instanceMatrix, 1);
        } else {
          inst.count = 0;
        }
        return;
      }
      inst.count = n;
      flagRange(inst.instanceMatrix, n);
    };
    syncInst(carWheelLeftInst, wheelCars * 2);
    syncInst(carWheelRightInst, wheelCars * 2);
    for (const bar of lightbarList) syncInst(bar.inst, bar.drawn);
    syncInst(carShadowInst, visibleCars);
    syncInst(busBodyInst, visibleBuses);
    syncInst(busHeaderInst, visibleBuses);
    syncInst(busWheelLeftInst, visibleBuses * 2);
    syncInst(busWheelRightInst, visibleBuses * 2);
    syncInst(busShadowInst, visibleBuses);
    if (visibleBuses > 0) flagRange(busStates, visibleBuses);
    syncInst(bus18FrontInst, visibleBuses18);
    syncInst(bus18RearInst, visibleBuses18);
    syncInst(bus18BellowsInst, visibleBuses18);
    syncInst(bus18SignInst, visibleBuses18);
    syncInst(bus18WheelLeftInst, visibleBuses18 * 3);
    syncInst(bus18WheelRightInst, visibleBuses18 * 3);
    syncInst(bus18ShadowInst, visibleBuses18 * 2);
    if (visibleBuses18 > 0) flagRange(bus18States, visibleBuses18);
    updateTrafficLights();

    // 2. Pedestrians
    for (const n of walkedNodes) n.walkers.length = 0;
    walkedNodes.length = 0;
    let pedBudget = jump ? NUM_PEDS : 6;
    for (let scanned = 0; scanned < NUM_PEDS && pedBudget > 0; scanned++) {
      const p = peds[pedCursor];
      pedCursor = (pedCursor + 1) % NUM_PEDS;
      const d = p.placed ? Math.hypot(p.x - focusX, p.z - focusZ) : Infinity;
      if (d <= (jump ? NEAR_RADIUS : PED_RADIUS)) continue;
      pedBudget--;
      spawnPed(p, jump ? 0 : 60, jump ? NEAR_RADIUS : 280, !jump);
    }
    meet(dt);
    gatherCurbs();
    pedCrowd.begin();
    for (let i = 0; i < NUM_PEDS; i++) {
      const p = peds[i];
      if (!p.placed) continue;
      walk(p, dt);
      renderPed(p, dt);
    }
    pedCrowd.end();

    // 3. Collision sparks, including the player's own impacts against buildings
    if (playerEntity && playerEntity.lastCollisionSpark) {
      const bs = playerEntity.lastCollisionSpark;
      spawnCollisionSparks(bs.x, bs.y, bs.z, bs.nx, bs.nz, bs.speed);
      playerEntity.lastCollisionSpark = null;
    }
    updateSparks(dt);
  }

  return {
    group,
    update,
    setCollisionListener,
    setTrams,
    cars,
    buses,
    peds,
    network,
    crosswalks: pedRoutes.crosswalks // road-paint.js paints its zebras from them
  };
}

export { createTrafficSystem };
