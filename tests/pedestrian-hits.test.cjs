// ?carma=1: the hit rule, the clean removal of a struck pedestrian (traffic.js strikePeds / retirePed), the guard
// that keeps the default build free of it, and the fixed pools and physics of pedestrian-hits.js.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

const traffic = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const pedestrians = readFileSync(join(__dirname, '../js/pedestrians.js'), 'utf8');
const BONES = vm.runInNewContext(`(${pedestrians.match(/const BONE = (\{[^}]*\});/)[1]})`);
const hits = loadModule(readFileSync(join(__dirname, '../js/pedestrian-hits.js'), 'utf8'), {
  imports: {
    'three/webgpu': {}, 'three/tsl': {}, './tsl-materials.js': {},
    './pedestrians.js': { PERSON_BONES: BONES },
    './city-config.js': { RAISED_GROUND: [{ minX: 50, maxX: 60, minZ: 0, maxZ: 10, top: 0.6 }],
      blockAt: (x) => (x > 200 ? { park: 0.2, median: false } : x > 100 ? { park: 1, median: false } : null) }
  },
  filename: 'pedestrian-hits.js'
});

function trafficFunction(name, context) {
  const match = traffic.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

const kmh = (v) => v / 3.6;

test('only the player car above 10 km/h strikes', () => {
  assert.equal(hits.STRIKE_SPEED, kmh(10));
  assert.equal(hits.strikes('car', kmh(10.5)), true);
  assert.equal(hits.strikes('car', kmh(60)), true);
  assert.equal(hits.strikes('car', kmh(9.5)), false);
  assert.equal(hits.strikes('car', 0), false);
  for (const type of ['cyclist', 'person', 'helicopter']) assert.equal(hits.strikes(type, kmh(40)), false, type);
});

// strikePeds and retirePed as traffic.js has them, with the pedestrians, nodes and the hit system as plain objects
function strikeHarness({ type = 'car', speed = kmh(36), heading = 0 } = {}) {
  const crossing = { walkers: [], curb: [] };
  const corner = { walkers: [], curb: [] };
  const ped = (x, z, extra = {}) => ({
    placed: true, x, z, node: null, waiting: false, through: false, route: {}, nextRoute: [], nextLeg: 1,
    v: 1.3, pause: 0, stuck: 0, conversation: null, socialTime: 0, rig: { placed: true }, ...extra
  });
  // the car's centre at the origin heading +z; its box is 0.86 x 2.23 m (traffic.js player.halfW/halfL)
  const struck = ped(0.3, 2.4, { node: crossing, waiting: true });
  const beside = ped(1.6, 0); // 1.6 m off the centre line: 0.46 m clear of the side
  const partner = ped(0.9, 2.6);
  struck.conversation = partner.conversation = { a: struck, b: partner, remaining: 5 };
  crossing.walkers.push(struck);
  crossing.curb.push(struck);
  corner.curb.push(struck);
  const peds = [struck, beside, partner];
  const calls = [];
  const sounds = [];
  const entity = { type, heading, speed, position: { x: 0, z: 0 } };
  const context = {
    Math,
    peds,
    pedPopulation: peds.length,
    walkedNodes: [crossing],
    curbNodes: [crossing, corner],
    clock: 10,
    player: { active: true, entity, x: 0, z: 0, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed,
      halfW: 0.86, halfL: 2.23 },
    collisionEvent: { kind: 'vehicle' },
    reportCollision(a, b, x, y, z, nx, nz, s) {
      sounds.push({ kind: context.collisionEvent.kind, a, b, s });
    },
    pedestrianHits: {
      strikes: hits.strikes,
      radius: hits.HIT_RADIUS,
      strike(p, e, along, across) {
        // the hit system sees the pedestrian while it is still placed (it breaks the rig's pose)
        calls.push({ p, e, along, across, placed: p.placed });
      }
    }
  };
  context.endConversation = trafficFunction('endConversation', context);
  context.retirePed = trafficFunction('retirePed', context);
  const strikePeds = trafficFunction('strikePeds', context);
  return { strikePeds, context, calls, sounds, struck, beside, partner, crossing, corner };
}

test('a fast player car strikes the pedestrian in its box, not the one beside it', () => {
  const h = strikeHarness();
  h.strikePeds();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].p, h.struck);
  assert.equal(h.calls[0].placed, true);
  assert.ok(Math.abs(h.calls[0].along - 2.4) < 1e-9 && Math.abs(h.calls[0].across - 0.3) < 1e-9);
  assert.equal(h.beside.placed, true);
  // one soft thud for audio, and the shared event goes back to its vehicle kind
  assert.equal(h.sounds.length, 1);
  assert.equal(h.sounds[0].kind, 'pedestrian');
  assert.equal(h.context.collisionEvent.kind, 'vehicle');
});

test('a turned car tests its own box', () => {
  // heading +x: the pedestrian at (2.4, 0.3) is ahead and 0.3 m to the car's right (model +x, the
  // car's left, points to world -z)
  const h = strikeHarness({ heading: Math.PI / 2 });
  h.struck.x = 2.4;
  h.struck.z = 0.3;
  h.beside.x = 0;
  h.beside.z = 1.6;
  h.partner.x = 9;
  h.strikePeds();
  assert.deepEqual(h.calls.map((c) => c.p === h.struck), [true]);
  assert.ok(Math.abs(h.calls[0].across + 0.3) < 1e-9);
});

test('slow cars, the bicycle and the walker pass through as before', () => {
  for (const options of [{ speed: kmh(9) }, { speed: kmh(-8) }, { type: 'cyclist', speed: kmh(30) },
    { type: 'person', speed: kmh(15) }]) {
    const h = strikeHarness(options);
    h.strikePeds();
    assert.equal(h.calls.length, 0, JSON.stringify(options));
    assert.equal(h.sounds.length, 0);
    assert.equal(h.struck.placed, true);
    assert.equal(h.crossing.walkers.length, 1);
  }
});

test('a struck pedestrian leaves the simulation with no stale state', () => {
  const h = strikeHarness();
  h.strikePeds();
  const p = h.struck;
  assert.equal(p.placed, false);
  assert.equal(p.rig.placed, false);
  assert.equal(p.node, null);
  assert.equal(p.waiting, false);
  assert.equal(p.route, null);
  assert.equal(p.nextRoute, null);
  assert.equal(p.v, 0);
  // off the crosswalk (drivers yield through n.walkers) and off both curb queues it was filed in
  assert.equal(h.crossing.walkers.length, 0);
  assert.equal(h.crossing.curb.length, 0);
  assert.equal(h.corner.curb.length, 0);
  // the conversation ends for both, which also ends its audio (audio-system.js drops a pair no longer pointing back)
  assert.equal(p.conversation, null);
  assert.equal(h.partner.conversation, null);
  assert.ok(h.partner.socialTime > h.context.clock);
  // a second pass finds nobody left to strike there
  h.strikePeds();
  assert.equal(h.calls.length, 1);
});

// The pedestrian part of update(): from clearing the walkers to the curb gathering, with spies
function pedSection(pedestrianHits, playerActive) {
  const start = traffic.indexOf('    for (const n of walkedNodes) n.walkers.length = 0;');
  const end = traffic.indexOf('    gatherCurbs();', start);
  assert.ok(start > 0 && end > start);
  const log = [];
  const struck = { placed: true, x: 0, z: 0 };
  const context = {
    Math, walkedNodes: [], pedCursor: 0, pedPopulation: 1, jump: false, peds: [struck], focusX: 0, focusZ: 0,
    PED_RADIUS: 320, NEAR_RADIUS: 350, pedestrianHits, player: { active: playerActive },
    strikePeds() {
      log.push('strike');
      struck.placed = false;
    },
    spawnPed(p) {
      log.push(p === struck ? 'respawn' : 'spawn');
      return true;
    }
  };
  vm.runInNewContext(traffic.slice(start, end), context);
  return log;
}

test('without the switch the frame never runs the hit test; with it a struck pedestrian is re-placed', () => {
  assert.deepEqual(pedSection(null, true), []);
  assert.deepEqual(pedSection({}, false), []);
  // the pool refills the slot the same frame, as for any retired pedestrian (spawnPed puts it 60-280 m out of view)
  assert.deepEqual(pedSection({}, true), ['strike', 'respawn']);
  assert.ok(traffic.includes('const pedestrianHits = options.pedestrianHits || null;'));
  assert.ok(traffic.includes('    if (pedestrianHits) pedestrianHits.update(dt, elapsed);'));
});

// A rig standing at (x, z): identity bone rotations, joints at the bind pose scaled by s
function fakeRig(x = 0, z = 0, s = 1) {
  const bind = [
    [0, 0.96, 0], [0, 1.12, -0.01], [0, 1.52, -0.012],
    [0.185, 1.43, -0.015], [0.227, 1.13, -0.015], [-0.185, 1.43, -0.015], [-0.227, 1.13, -0.015],
    [0.09, 0.92, 0], [0.09, 0.5, 0], [0.09, 0.08, 0], [0.09, 0.02, 0.135],
    [-0.09, 0.92, 0], [-0.09, 0.5, 0], [-0.09, 0.08, 0], [-0.09, 0.02, 0.135]
  ].map(([bx, by, bz]) => ({ x: bx, y: by, z: bz }));
  const pose = new Float32Array(31 * 4);
  for (let b = 0; b < 15; b++) {
    pose[b * 8 + 3] = 1; // identity: world = bind * s + t
    pose[b * 8 + 4] = x;
    pose[b * 8 + 6] = z;
    pose[b * 8 + 7] = s;
  }
  pose.set([7.5, 1, 1.02, 0.3], 30 * 4);
  return { pose, bind, s, placed: true };
}

test('the part pool recycles the oldest pieces when full', () => {
  const pool = hits.createPartPool(12, hits.createRandom(3));
  const victims = [0, 1, 2].map((i) => pool.breakRig(fakeRig(i * 10, 0), 0, 10, 0, 0, []));
  assert.equal(pool.parts.length, 12);
  assert.equal(pool.active(), 12);
  // the third victim took the first victim's slots: the first victim's pieces are its pieces now
  assert.deepEqual(victims[0].map((part, i) => part === victims[2][i]), [true, true, true, true, true, true]);
  assert.ok(victims[2].every((part) => part.x > 15));
  assert.ok(victims[1].every((part) => part.active && part.x > 5 && part.x < 15));
});

test('pieces fly with the car, land, settle on the ground and are gone by the end of their life', () => {
  const pool = hits.createPartPool(6, hits.createRandom(7));
  const parts = pool.breakRig(fakeRig(0, 0), 0, kmh(40), 0, 0, []);
  assert.deepEqual(parts.map((part) => part.def.name), ['head', 'torso', 'armL', 'armR', 'legL', 'legR']);
  assert.ok(parts.every((part) => part.vz > kmh(40) * 0.9 && part.vy > 1.5));
  let landed = 0;
  const dt = 1 / 60;
  for (let t = 0; t < 3.5; t += dt) pool.update(dt, () => 0.22, () => landed++);
  assert.equal(landed, 6);
  for (const part of parts) {
    assert.ok(part.active && part.rest, `${part.def.name} at rest`);
    assert.ok(part.z > 3 && part.z < 20, `${part.def.name} thrown ahead: ${part.z}`);
    // its lowest end lies on the sidewalk surface; long pieces lie flat
    const q = part.q;
    const rot = (v) => {
      const [x, y, z] = v;
      const tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
      return [x + q[3] * tx + q[1] * tz - q[2] * ty, y + q[3] * ty + q[2] * tx - q[0] * tz, z + q[3] * tz + q[0] * ty - q[1] * tx];
    };
    const a = rot(part.ea), b = rot(part.eb);
    const low = part.y + Math.min(a[1], b[1]) - part.def.radius;
    assert.ok(Math.abs(low - 0.22) < 0.02, `${part.def.name} rests on the ground: ${low}`);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len > 0.1) assert.ok(Math.abs(b[1] - a[1]) < 0.15 * len, `${part.def.name} lies flat`);
  }
  for (let t = 0; t < 5; t += dt) pool.update(dt, () => 0.22);
  assert.equal(pool.active(), 0);
});

test('a piece keeps its own bones and collapses the rest onto the cut', () => {
  const pool = hits.createPartPool(6, hits.createRandom(1));
  const rig = fakeRig(4, -2, 1.05);
  pool.breakRig(rig, 5, 0, 0, 0);
  const out = new Float32Array(6 * 31 * 4);
  assert.equal(pool.write(out), 6);
  const scale = (piece, bone) => out[piece * 124 + bone * 8 + 7];
  const at = (piece, bone) => [0, 1, 2].map((k) => out[piece * 124 + bone * 8 + 4 + k]);
  // the head piece (0) draws only the head; the torso (1) only pelvis and chest
  for (let b = 0; b < 15; b++) {
    assert.equal(scale(0, b), b === BONES.HEAD ? Math.fround(1.05) : 0);
    assert.equal(scale(1, b), b === BONES.PELVIS || b === BONES.CHEST ? Math.fround(1.05) : 0);
  }
  // unmoved yet: the torso's collapsed head bone sits at the neck joint, the head piece's collapsed chest likewise
  const neck = [4, 1.52 * 1.05, -2 - 0.012 * 1.05];
  for (const piece of [0, 1]) {
    const bone = piece === 0 ? BONES.CHEST : BONES.HEAD;
    at(piece, bone).forEach((v, k) => assert.ok(Math.abs(v - neck[k]) < 1e-5, `${piece}: ${at(piece, bone)}`));
  }
  // every piece wears the person's dress (seed, female, girth, hair)
  for (let piece = 0; piece < 6; piece++) {
    assert.deepEqual([...out.subarray(piece * 124 + 120, piece * 124 + 124)], [7.5, 1, Math.fround(1.02), Math.fround(0.3)]);
  }
});

test('the decal ring overwrites its oldest decal and empties once everything has faded', () => {
  const ring = hits.createDecalRing(10);
  for (let i = 0; i < 15; i++) ring.add(i, 0.02, 0, 0, 1, 2, i, 1, -1, i * 0.1);
  assert.equal(ring.count, 10);
  assert.equal(ring.cursor, 5);
  assert.equal(ring.matrices[12], 10); // slot 0 now holds the eleventh decal (x = 10)
  assert.equal(ring.matrices[5 * 16 + 12], 5);
  assert.ok(Math.abs(ring.data[2] - 1.0) < 1e-6); // its birth time
  assert.equal(ring.expired(1.4 + hits.DECAL_LIFE - 0.01), false);
  assert.equal(ring.expired(1.4 + hits.DECAL_LIFE + 0.01), true);
  ring.clear();
  assert.equal(ring.count, 0);
  assert.equal(ring.cursor, 0);
  // a decal's matrix: width across, length along its heading, flat on the ground
  ring.add(3, 0.24, -1, Math.PI / 2, 0.4, 2, 0, 1, 0.2, 0);
  const m = ring.matrices;
  assert.ok(Math.abs(m[0]) < 1e-6 && Math.abs(m[2] + 0.4) < 1e-6); // local x (width) along world -z
  assert.ok(Math.abs(m[8] - 2) < 1e-6 && Math.abs(m[10]) < 1e-6); // local z (length) along world +x
  assert.deepEqual([m[12], m[13], m[14]].map((v) => Math.round(v * 100) / 100), [3, 0.24, -1]);
});

test('blood and pieces lie on raised ground, any curb island (park rings too) or the road', () => {
  assert.equal(hits.surfaceHeight(55, 5), 0.6);
  assert.equal(hits.surfaceHeight(120, 5), 0.26); // a park block's walks
  assert.equal(hits.surfaceHeight(220, 5), 0.24); // sidewalks (0.22) and plazas (0.24)
  assert.equal(hits.surfaceHeight(0, 5), 0);
});
