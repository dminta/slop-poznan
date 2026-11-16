import * as THREE from 'three/webgpu';
import { Fn, attribute, attributeArray, uniform, uv, float, color, mix, smoothstep, clamp, abs, sin, cos, length } from 'three/tsl';
import { PERSON_BONES, buildPersonGeometry, createPersonMaterial } from './pedestrians.js';
import { transparentEffectMRT } from './tsl-materials.js';
import { RAISED_GROUND, blockAt } from './city-config.js';

// js/pedestrian-hits.js
// The opt-in `?carma=1` mode (main.js): the player's car, above STRIKE_SPEED, runs pedestrians down. traffic.js finds
// the contact and retires the pedestrian (its pool refills the slot as for any retired one); this module only shows
// what is left: the body broken into six skinned pieces that are thrown, tumble, bounce, settle and sink, and a blood
// smear dragged along the car's path with a little spatter, as ground decals that dry and fade.
// - Nothing here exists without the switch: main.js builds this only when it is on and traffic.js holds null
//   otherwise, so the default build has no extra meshes, draws, uploads or random numbers.
// - The pieces are the pedestrian's own lofted body (pedestrians.js geometry and material), so they wear exactly the
//   clothes, skin and hair the GPU dressed the person in: each piece is one more instance of the person mesh whose
//   pose keeps that piece's bones and collapses every other bone to the joint at the cut (scale 0), which closes the
//   torn end. Their physics is a capsule per piece, in plain numbers (no three.js objects), so tests can run it.
// - Fixed pools allocated at build time (MAX_PARTS pieces, MAX_DECALS decals, MAX_TRAILS smears); a full pool
//   recycles its oldest entry. Its own seeded generator keeps traffic's shared Math.random stream untouched.

// Hit rule. 10 km/h is a brisk walk plus a little: below it a car nudging through a crowd (parking, creeping at a
// zebra) keeps today's pass-through behaviour.
const STRIKE_SPEED = 10 / 3.6; // m/s
const HIT_RADIUS = 0.28; // m: half a pedestrian's shoulder width, added to the car's box
// A ~75 kg body against the ~1.4 t taxi: the car keeps 95% of its speed (momentum shared in a plastic impact).
const MOMENTUM_KEEP = 0.95;

// Pieces: head, torso, two arms, two legs. 8 victims at once is more than a street run produces within the 4-8 s the
// pieces last; a ninth recycles the oldest pieces.
const PARTS_PER_VICTIM = 6;
const MAX_PARTS = 8 * PARTS_PER_VICTIM;
const PART_LIFE_MIN = 4; // s
const PART_LIFE_MAX = 8;
const PART_SINK = 1.2; // s at the end of its life it takes a piece to sink out of sight below the ground
const GRAVITY = 9.81;
const RESTITUTION = 0.28; // share of the vertical speed kept in a bounce (a limp body barely bounces)
const GROUND_FRICTION = 7.0; // m/s^2 sliding deceleration on the ground (cloth on asphalt, mu ~0.7)
const IMPACT_FRICTION = 0.7; // the same mu against the landing's vertical impulse
// With these the pieces of a body struck at 40 km/h end 12-18 m ahead, at 60 km/h 25-34 m (headless, 3 seeds): a
// forward throw with a short slide, not a 20 m skid along the road
const SPIN_DAMPING = 5.0; // 1/s tumble decay on the ground
const TOPPLE_RATE = 6.0; // 1/s a long piece on the ground falls flat

// Decals: the impact pool, SPATTER droplets thrown ahead, the smear and a splat where the head and torso land.
// About 20 decals a hit, so 192 keep the last ~9 hits; they last DECAL_LIFE s, fading out over the last DECAL_FADE.
const MAX_DECALS = 192;
const DECAL_LIFE = 45; // s
const DECAL_FADE = 15;
const DECAL_LIFT = 0.02; // m above the ground: over the road paint (0.012 m) and below the contact shadows
const SPATTER = 7;
// The smear follows the point of the car that hit the person for 2.5-6 m (longer the faster the car went), laid in
// SMEAR_STEP pieces, for at most SMEAR_TIME s (a car that stops leaves a short one).
const MAX_TRAILS = 4;
const SMEAR_STEP = 0.45; // m
const SMEAR_WIDTH = 0.5; // m, a body's width dragged under the car
const SMEAR_MIN = 2.5;
const SMEAR_MAX = 6;
const SMEAR_TIME = 1.5;

const B = PERSON_BONES;
const BONE_COUNT = 15;
const POSE_STRIDE = BONE_COUNT * 2 + 1; // vec4s per instance, as pedestrians.js lays out a rig's pose
// Skeleton tree, child -> parent (pedestrians.js BONE)
const PARENT = [-1, B.PELVIS, B.CHEST, B.CHEST, B.UPPER_ARM_L, B.CHEST, B.UPPER_ARM_R,
  B.PELVIS, B.THIGH_L, B.SHIN_L, B.FOOT_L, B.PELVIS, B.THIGH_R, B.SHIN_R, B.FOOT_R];
// Each piece: its bones and the capsule its physics uses (two joints, the second optionally pushed on past itself,
// and a radius in m)
const PART_DEFS = [
  { name: 'head', bones: [B.HEAD], a: B.HEAD, b: B.HEAD, up: 0.13, radius: 0.11 },
  { name: 'torso', bones: [B.PELVIS, B.CHEST], a: B.PELVIS, b: B.HEAD, radius: 0.15 },
  { name: 'armL', bones: [B.UPPER_ARM_L, B.FOREARM_L], a: B.UPPER_ARM_L, b: B.FOREARM_L, extend: 1.1, radius: 0.05 },
  { name: 'armR', bones: [B.UPPER_ARM_R, B.FOREARM_R], a: B.UPPER_ARM_R, b: B.FOREARM_R, extend: 1.1, radius: 0.05 },
  { name: 'legL', bones: [B.THIGH_L, B.SHIN_L, B.FOOT_L, B.TOE_L], a: B.THIGH_L, b: B.FOOT_L, radius: 0.075 },
  { name: 'legR', bones: [B.THIGH_R, B.SHIN_R, B.FOOT_R, B.TOE_R], a: B.THIGH_R, b: B.FOOT_R, radius: 0.075 }
];
for (const def of PART_DEFS) {
  def.mask = new Array(BONE_COUNT).fill(false);
  for (const b of def.bones) def.mask[b] = true;
  // The joint each other bone collapses to: the cut it shares with this piece, else the piece's own first joint
  def.pinch = [];
  for (let b = 0; b < BONE_COUNT; b++) {
    if (def.mask[b]) def.pinch[b] = -1;
    else if (PARENT[b] >= 0 && def.mask[PARENT[b]]) def.pinch[b] = b;
    else def.pinch[b] = PARENT.findIndex((p, c) => p === b && def.mask[c]);
    if (def.pinch[b] < 0 && !def.mask[b]) def.pinch[b] = def.bones[0];
  }
}

// The surface blood and pieces lie on: raised lawns and plazas (city-config.js RAISED_GROUND), else a curb island's
// paving, else the road. Islands are 0.22 m sidewalks, 0.24 m paved plazas (city-grid.js PLAZA_Y) or, on park blocks,
// 0.26 m park walks (PARK_Y); one height per kind of island, the higher where they differ, floats a decal at most 2 cm
// over a sidewalk instead of hiding it under a plaza. Lawns inside the 0.41 m park beds hide it (blood soaks in). Not
// controllers.js getGroundHeight: its walker ground leaves park blocks at road level, under their paving.
const PAVED_TOP = 0.24;
const PARK_TOP = 0.26;
function surfaceHeight(x, z) {
  for (let i = 0; i < RAISED_GROUND.length; i++) {
    const r = RAISED_GROUND[i];
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return r.top;
  }
  const b = blockAt(x, z);
  if (!b) return 0;
  return b.park > 0.6 && !b.median ? PARK_TOP : PAVED_TOP;
}

function strikes(entityType, speed) {
  return entityType === 'car' && speed > STRIKE_SPEED;
}

// mulberry32: the visuals' own stream
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Quaternions as [x, y, z, w] at offset `o` of a flat array
function qmul(a, ao, b, bo, out, oo) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[oo] = aw * bx + ax * bw + ay * bz - az * by;
  out[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
// v (x, y, z) rotated by q into out[oo..oo+2]
function qrot(q, qo, x, y, z, out, oo) {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[oo] = x + qw * tx + qy * tz - qz * ty;
  out[oo + 1] = y + qw * ty + qz * tx - qx * tz;
  out[oo + 2] = z + qw * tz + qx * ty - qy * tx;
}
// q <- rotation by `angle` about the unit axis, then q
const _dq = new Float64Array(4);
const _qt = new Float64Array(4);
function qpremul(q, ax, ay, az, angle) {
  const s = Math.sin(angle * 0.5);
  _dq[0] = ax * s; _dq[1] = ay * s; _dq[2] = az * s; _dq[3] = Math.cos(angle * 0.5);
  qmul(_dq, 0, q, 0, _qt, 0);
  const n = Math.hypot(_qt[0], _qt[1], _qt[2], _qt[3]) || 1;
  for (let i = 0; i < 4; i++) q[i] = _qt[i] / n;
}

function createPart() {
  return {
    active: false, def: null, born: 0, age: 0, life: 0, rest: false, bled: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, ground: 0, sink: 0,
    q: new Float64Array([0, 0, 0, 1]),
    // capsule ends relative to the centre, in the frame of the impact
    ea: new Float64Array(3), eb: new Float64Array(3),
    // the piece's pose at the impact relative to its centre: per bone (quaternion) (translation, scale), then info
    base: new Float32Array(POSE_STRIDE * 4)
  };
}

/**
 * The body pieces: a fixed pool and its physics. `ground(x, z)` gives the surface height. `write(target)` lays the
 * live pieces' poses into `target` (pedestrians.js layout) and returns how many it wrote.
 */
function createPartPool(maxParts = MAX_PARTS, random = createRandom(1)) {
  const parts = Array.from({ length: maxParts }, createPart);
  let cursor = 0;
  let clock = 0;
  const joint = new Float64Array(BONE_COUNT * 3);
  const _v = new Float64Array(3);
  const _a = new Float64Array(3);
  const _b = new Float64Array(3);

  // A full pool reuses the slot after the newest, which is the oldest
  function allocate() {
    const part = parts[cursor];
    cursor = (cursor + 1) % parts.length;
    return part;
  }

  /**
   * Break the rig's current pose (world space) into pieces moving with the car's velocity (vx, vz) plus scatter.
   * `side` (-1..1, + on the car's left) pushes them off the car's line. Returns the pieces.
   */
  function breakRig(rig, vx, vz, side = 0, ground = 0, out = null) {
    const pose = rig.pose;
    const s = rig.s;
    for (let b = 0; b < BONE_COUNT; b++) {
      const j = rig.bind[b];
      qrot(pose, b * 8, j.x * s, j.y * s, j.z * s, joint, b * 3);
      joint[b * 3] += pose[b * 8 + 4];
      joint[b * 3 + 1] += pose[b * 8 + 5];
      joint[b * 3 + 2] += pose[b * 8 + 6];
    }
    const speed = Math.hypot(vx, vz);
    const fx = speed > 0.01 ? vx / speed : 0, fz = speed > 0.01 ? vz / speed : 0;
    // the car's left, from its direction of travel: (cos h, -sin h) for (sin h, cos h)
    const lx = fz, lz = -fx;
    for (const def of PART_DEFS) {
      const part = allocate();
      part.active = true;
      part.def = def;
      part.born = clock;
      part.age = 0;
      part.life = PART_LIFE_MIN + random() * (PART_LIFE_MAX - PART_LIFE_MIN);
      part.rest = false;
      part.bled = false;
      part.ground = ground;
      part.sink = 0;
      // capsule in world space at the impact
      const ia = def.a * 3, ib = def.b * 3;
      _a[0] = joint[ia]; _a[1] = joint[ia + 1]; _a[2] = joint[ia + 2];
      _b[0] = joint[ib]; _b[1] = joint[ib + 1]; _b[2] = joint[ib + 2];
      if (def.extend) for (let k = 0; k < 3; k++) _b[k] = _a[k] + (_b[k] - _a[k]) * (1 + def.extend);
      if (def.up) {
        qrot(pose, def.a * 8, 0, def.up * s, 0, _v, 0);
        for (let k = 0; k < 3; k++) _a[k] = _b[k] = _a[k] + _v[k];
      }
      const cx = (_a[0] + _b[0]) * 0.5, cy = (_a[1] + _b[1]) * 0.5, cz = (_a[2] + _b[2]) * 0.5;
      part.x = cx; part.y = cy; part.z = cz;
      for (let k = 0; k < 3; k++) {
        part.ea[k] = _a[k] - (k === 0 ? cx : k === 1 ? cy : cz);
        part.eb[k] = _b[k] - (k === 0 ? cx : k === 1 ? cy : cz);
      }
      part.q[0] = part.q[1] = part.q[2] = 0;
      part.q[3] = 1;
      // the pose relative to the centre; the other bones collapse onto the cut
      const base = part.base;
      for (let b = 0; b < BONE_COUNT; b++) {
        const o = b * 8;
        if (def.mask[b]) {
          for (let k = 0; k < 4; k++) base[o + k] = pose[o + k];
          base[o + 4] = pose[o + 4] - cx;
          base[o + 5] = pose[o + 5] - cy;
          base[o + 6] = pose[o + 6] - cz;
          base[o + 7] = pose[o + 7];
        } else {
          const p = def.pinch[b] * 3;
          base[o] = base[o + 1] = base[o + 2] = 0;
          base[o + 3] = 1;
          base[o + 4] = joint[p] - cx;
          base[o + 5] = joint[p + 1] - cy;
          base[o + 6] = joint[p + 2] - cz;
          base[o + 7] = 0;
        }
      }
      for (let k = 0; k < 4; k++) base[BONE_COUNT * 8 + k] = pose[BONE_COUNT * 8 + k];
      // thrown ahead at 0.95-1.2x the car's speed, up by 1.5-3 m/s plus a share of the speed, and scattered
      const ahead = speed * (0.95 + random() * 0.25);
      const sideways = (side * 0.8 + (random() - 0.5) * 1.6) * (0.4 + speed * 0.08);
      part.vx = fx * ahead + lx * sideways + (random() - 0.5) * 1.2;
      part.vz = fz * ahead + lz * sideways + (random() - 0.5) * 1.2;
      part.vy = 1.5 + random() * 1.5 + speed * 0.18;
      const spin = (def.radius < 0.1 ? 5 : 3) + random() * 5;
      let wx = random() - 0.5, wy = random() - 0.5, wz = random() - 0.5;
      const wn = Math.hypot(wx, wy, wz) || 1;
      wx /= wn; wy /= wn; wz /= wn;
      part.wx = wx * spin; part.wy = wy * spin; part.wz = wz * spin;
      if (out) out.push(part);
    }
    return out;
  }

  /**
   * Advance every piece by dt. `ground(x, z)` is sampled under a piece in flight; `onLand(part)` fires the first
   * time a piece touches down.
   */
  function update(dt, ground = null, onLand = null) {
    clock += dt;
    for (const part of parts) {
      if (!part.active) continue;
      part.age += dt;
      if (part.age >= part.life) {
        part.active = false;
        continue;
      }
      const sinkStart = part.life - PART_SINK;
      part.sink = part.age > sinkStart ? (part.age - sinkStart) / PART_SINK * (part.def.radius * 2 + 0.12) : 0;
      if (part.rest) continue;
      part.vy -= GRAVITY * dt;
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.z += part.vz * dt;
      const w = Math.hypot(part.wx, part.wy, part.wz);
      if (w > 1e-6) qpremul(part.q, part.wx / w, part.wy / w, part.wz / w, w * dt);
      if (ground) part.ground = ground(part.x, part.z);
      qrot(part.q, 0, part.ea[0], part.ea[1], part.ea[2], _a, 0);
      qrot(part.q, 0, part.eb[0], part.eb[1], part.eb[2], _b, 0);
      const low = part.y + Math.min(_a[1], _b[1]) - part.def.radius;
      if (low >= part.ground) continue;
      // on the ground: stand on the lower end, bounce a little, slide, stop spinning and fall flat
      part.y += part.ground - low;
      // the landing's friction impulse (mu times the vertical impulse) and then sliding friction
      let loss = GROUND_FRICTION * dt;
      if (part.vy < 0) {
        loss += IMPACT_FRICTION * (1 + RESTITUTION) * -part.vy;
        part.vy = -part.vy * RESTITUTION;
      }
      if (part.vy < 0.6) part.vy = 0;
      const hs = Math.hypot(part.vx, part.vz);
      const keep = hs > 1e-6 ? Math.max(0, hs - loss) / hs : 0;
      part.vx *= keep;
      part.vz *= keep;
      const spin = Math.max(0, 1 - SPIN_DAMPING * dt);
      part.wx *= spin; part.wy *= spin; part.wz *= spin;
      const ux = _b[0] - _a[0], uy = _b[1] - _a[1], uz = _b[2] - _a[2];
      const len = Math.hypot(ux, uy, uz);
      const flat = len <= 0.1 || Math.abs(uy) < 0.1 * len; // a piece comes to rest only once it lies down
      if (len > 0.1) {
        // turn the capsule's axis towards the horizontal, by part of its tilt: a positive turn about the horizontal
        // axis k = (-uz, 0, ux) / h raises the axis (k x u has y = h), so the turn is minus the tilt
        const h = Math.hypot(ux, uz);
        if (h > 1e-4 && Math.abs(uy) > 0.02 * len) {
          const tilt = Math.atan2(uy, h);
          qpremul(part.q, -uz / h, 0, ux / h, -tilt * Math.min(1, TOPPLE_RATE * dt));
        }
      }
      if (!part.bled && onLand) {
        part.bled = true;
        onLand(part);
      }
      if (flat && hs * keep < 0.25 && part.vy === 0 && w < 0.6) {
        part.rest = true;
        part.vx = part.vz = part.wx = part.wy = part.wz = 0;
      }
    }
  }

  // The live pieces' poses into `target` (Float32Array, POSE_STRIDE vec4s each); returns how many
  function write(target) {
    let n = 0;
    for (const part of parts) {
      if (!part.active) continue;
      const base = part.base;
      const o = n * POSE_STRIDE * 4;
      const py = part.y - part.sink;
      for (let b = 0; b < BONE_COUNT; b++) {
        const bo = b * 8;
        qmul(part.q, 0, base, bo, target, o + bo);
        qrot(part.q, 0, base[bo + 4], base[bo + 5], base[bo + 6], target, o + bo + 4);
        target[o + bo + 4] += part.x;
        target[o + bo + 5] += py;
        target[o + bo + 6] += part.z;
        target[o + bo + 7] = base[bo + 7];
      }
      for (let k = 0; k < 4; k++) target[o + BONE_COUNT * 8 + k] = base[BONE_COUNT * 8 + k];
      n++;
    }
    return n;
  }

  return {
    parts,
    breakRig,
    update,
    write,
    active: () => parts.reduce((n, part) => n + (part.active ? 1 : 0), 0)
  };
}

/**
 * Ground decals in a ring: `add` writes one (centre, heading of its length, width, length, seed, strength at its
 * start and end, or end < 0 for a round splat) into `matrices` (16 floats each) and `data` (vec4 each: seed,
 * start strength, birth time, end strength) and reports the index. `count` is the high-water mark; `clear()` empties
 * the ring once everything has faded.
 */
function createDecalRing(maxDecals = MAX_DECALS) {
  const matrices = new Float32Array(maxDecals * 16);
  const data = new Float32Array(maxDecals * 4);
  const ring = { matrices, data, max: maxDecals, cursor: 0, count: 0, newest: -Infinity, dirty: false };
  ring.add = (x, y, z, heading, width, len, seed, s0, s1, time) => {
    const i = ring.cursor;
    ring.cursor = (ring.cursor + 1) % maxDecals;
    ring.count = Math.max(ring.count, i + 1);
    const c = Math.cos(heading), s = Math.sin(heading);
    const m = i * 16;
    matrices[m] = c * width; matrices[m + 1] = 0; matrices[m + 2] = -s * width; matrices[m + 3] = 0;
    matrices[m + 4] = 0; matrices[m + 5] = 1; matrices[m + 6] = 0; matrices[m + 7] = 0;
    matrices[m + 8] = s * len; matrices[m + 9] = 0; matrices[m + 10] = c * len; matrices[m + 11] = 0;
    matrices[m + 12] = x; matrices[m + 13] = y; matrices[m + 14] = z; matrices[m + 15] = 1;
    const d = i * 4;
    data[d] = seed; data[d + 1] = s0; data[d + 2] = time; data[d + 3] = s1;
    ring.newest = time;
    ring.dirty = true;
    return i;
  };
  ring.expired = (time) => time > ring.newest + DECAL_LIFE;
  ring.clear = () => {
    ring.cursor = 0;
    ring.count = 0;
    ring.newest = -Infinity;
  };
  return ring;
}

// Blood on the ground: fresh it is a wet, glossy dark red, drying darker and duller; smear segments carry streaks
// along their length (the same pattern across every segment of one smear, so they join), splats a ragged round edge
function createBloodMaterial(time) {
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, metalness: 0 });
  const decal = attribute('bloodDecal', 'vec4');
  const age = time.sub(decal.z);
  const fade = float(1).sub(smoothstep(DECAL_LIFE - DECAL_FADE, DECAL_LIFE, age));
  const dry = smoothstep(0, 25, age);
  const opacity = Fn(() => {
    const p = uv();
    const seed = decal.x;
    const splat = smoothstep(-0.01, 0.01, decal.w.negate());
    // smear: across -1..1, along 0..1 (v = 1 at the segment's start)
    const across = p.x.mul(2).sub(1);
    const strength = mix(decal.w, decal.y, p.y);
    const streaks = sin(across.mul(9.0).add(seed.mul(7.1))).mul(sin(across.mul(23.0).add(seed.mul(3.3)))).mul(0.3).add(0.75);
    const edge = smoothstep(1.0, 0.55, abs(across).add(sin(p.y.mul(6.0).add(seed.mul(5.0))).mul(0.08)));
    const smear = clamp(streaks.mul(edge).mul(strength), 0, 1);
    // splat: a ragged disc
    const d = p.sub(0.5).mul(2);
    const r = length(d);
    const rim = sin(d.x.mul(7.0).add(seed.mul(13.0))).mul(cos(d.y.mul(6.0).sub(seed.mul(9.0)))).mul(0.14).add(0.78);
    const blob = smoothstep(rim, rim.sub(0.14), r).mul(decal.y);
    return mix(smear, blob, splat).mul(fade).mul(0.92);
  })();
  mat.colorNode = mix(color(0x7a0909), color(0x3a0606), dry);
  mat.roughnessNode = mix(float(0.22), float(0.7), dry);
  mat.opacityNode = opacity;
  mat.mrtNode = transparentEffectMRT; // SSR keeps seeing the road underneath (rendering.md)
  return mat;
}

/**
 * The mode's scene side. `group` goes under traffic's root (a dynamic, unculled root). traffic.js calls
 * `strike(p, entity, along, across, vx, vz, speed)` for each hit pedestrian (before retiring it) and `update(dt,
 * elapsed)` once a frame.
 */
function createPedestrianHits({ maxParts = MAX_PARTS, maxDecals = MAX_DECALS, seed = 0x5eed } = {}) {
  const random = createRandom(seed);
  const group = new THREE.Group();
  group.name = 'PedestrianHits';
  const ground = surfaceHeight;
  let updates = 0;
  let hits = 0;

  const pool = createPartPool(maxParts, random);
  const pose = attributeArray(maxParts * POSE_STRIDE, 'vec4').toReadOnly().setPBO(true);
  const partMesh = new THREE.Mesh(buildPersonGeometry(1), createPersonMaterial(pose));
  partMesh.name = 'PedestrianHitParts';
  partMesh.count = 1; // one degenerate (all-zero) person until the first frames, so the pipelines compile up front
  partMesh.frustumCulled = false;
  partMesh.castShadow = true;
  partMesh.receiveShadow = true;

  const ring = createDecalRing(maxDecals);
  const time = uniform(0);
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI * 0.5);
  const decalAttr = new THREE.InstancedBufferAttribute(ring.data, 4);
  plane.setAttribute('bloodDecal', decalAttr);
  const decalMesh = new THREE.InstancedMesh(plane, createBloodMaterial(time), maxDecals);
  decalMesh.name = 'PedestrianHitBlood';
  decalMesh.frustumCulled = false;
  decalMesh.castShadow = false;
  decalMesh.receiveShadow = true;
  decalMesh.renderOrder = 997; // under the cars' contact shadows (998)
  decalMesh.instanceMatrix.array.fill(0); // not the identity at the origin: compiled, never seen
  decalMesh.count = 1;
  group.add(partMesh, decalMesh);

  const trails = Array.from({ length: MAX_TRAILS }, () => ({
    active: false, entity: null, lx: 0, lz: 0, x: 0, z: 0, dragged: 0, length: 0, age: 0, seed: 0
  }));
  let trailCursor = 0;

  function decal(x, z, heading, width, len, seedValue, s0, s1, clock) {
    ring.add(x, ground(x, z) + DECAL_LIFT, z, heading, width, len, seedValue, s0, s1, clock);
  }
  let clock = 0;

  function strike(p, entity, along, across, vx, vz, speed) {
    hits++;
    const heading = entity.heading || 0;
    const sn = Math.sin(heading), cs = Math.cos(heading);
    const g = ground(p.x, p.z);
    // the pieces, if the body has a pose to break (a rig placed this very frame has none yet)
    if (p.rig && p.rig.placed) {
      p.rig.solve();
      pool.breakRig(p.rig, vx, vz, Math.max(-1, Math.min(1, across / 0.9)), g);
    }
    // the pool where they were struck, and droplets thrown ahead
    const fx = speed > 0.01 ? vx / speed : sn, fz = speed > 0.01 ? vz / speed : cs;
    decal(p.x, p.z, random() * Math.PI, 1.1 + random() * 0.5, 1.1 + random() * 0.5, random() * 50, 1, -1, clock);
    for (let i = 0; i < SPATTER; i++) {
      const d = 0.6 + random() * (1.5 + speed * 0.2);
      const off = (random() - 0.5) * 1.6;
      const size = 0.12 + random() * 0.3;
      decal(p.x + fx * d + fz * off, p.z + fz * d - fx * off, random() * Math.PI, size, size * (1 + random() * 0.6),
        random() * 50, 0.6 + random() * 0.4, -1, clock);
    }
    // the smear follows the point of the car that hit them (on the car's frame), across clamped to the wheels
    const trail = trails[trailCursor];
    trailCursor = (trailCursor + 1) % trails.length;
    trail.active = true;
    trail.entity = entity;
    trail.lx = Math.max(-0.72, Math.min(0.72, across));
    trail.lz = along;
    trail.x = p.x;
    trail.z = p.z;
    trail.dragged = 0;
    trail.length = Math.max(SMEAR_MIN, Math.min(SMEAR_MAX, SMEAR_MIN + speed * 0.2));
    trail.age = 0;
    trail.seed = random() * 50;
    // the car loses the body's share of its momentum
    if (typeof entity.speed === 'number') entity.speed *= MOMENTUM_KEEP;
  }

  function updateTrail(trail, dt) {
    trail.age += dt;
    const e = trail.entity;
    const h = e.heading || 0;
    const sn = Math.sin(h), cs = Math.cos(h);
    const x = e.position.x + trail.lx * cs + trail.lz * sn;
    const z = e.position.z - trail.lx * sn + trail.lz * cs;
    const dx = x - trail.x, dz = z - trail.z;
    const d = Math.hypot(dx, dz);
    // more than a frame's travel at any drivable speed: a teleport or a mode switch, not a drag
    if (d > 4) {
      trail.active = false;
      return;
    }
    if (d >= SMEAR_STEP) {
      const len = Math.min(d, trail.length - trail.dragged);
      const k = len / d;
      const s0 = 1 - 0.7 * trail.dragged / trail.length;
      const s1 = 1 - 0.7 * (trail.dragged + len) / trail.length;
      decal(trail.x + dx * k * 0.5, trail.z + dz * k * 0.5, Math.atan2(dx, dz), SMEAR_WIDTH, len, trail.seed, s0, s1, clock);
      trail.x += dx * k;
      trail.z += dz * k;
      trail.dragged += len;
    }
    if (trail.dragged >= trail.length - 1e-6 || trail.age > SMEAR_TIME || e.type !== 'car') trail.active = false;
  }

  const onLand = (part) => {
    if (part.def.name !== 'torso' && part.def.name !== 'head') return;
    const size = part.def.name === 'torso' ? 0.8 + random() * 0.4 : 0.45 + random() * 0.2;
    decal(part.x, part.z, random() * Math.PI, size, size * (1 + random() * 0.4), random() * 50, 0.85, -1, clock);
  };

  function flag(attr, n, itemSize) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * itemSize);
    attr.needsUpdate = true;
  }

  function update(dt, elapsed) {
    clock = elapsed;
    time.value = elapsed;
    const warm = ++updates <= 2;
    for (const trail of trails) if (trail.active) updateTrail(trail, dt);
    pool.update(dt, ground, onLand);

    // pieces: the live poses, packed at the front of the buffer
    const poseAttr = pose.value;
    const n = pool.write(poseAttr.array);
    partMesh.visible = n > 0 || warm;
    partMesh.count = n > 0 ? n : 1;
    if (n > 0) {
      flag(poseAttr, n, POSE_STRIDE * 4);
      // three.js creates this texture for WebGL2 PBO reads, but CPU buffer updates do not invalidate it
      if (poseAttr.pbo) poseAttr.pbo.needsUpdate = true;
    }

    // decals: upload what changed this frame; hide the mesh once everything has faded
    if (ring.count > 0 && ring.expired(elapsed)) ring.clear();
    if (ring.dirty) {
      ring.dirty = false;
      const matrix = decalMesh.instanceMatrix; // read each time: main.js swaps it for a storage attribute on WebGPU
      matrix.array.set(ring.matrices.subarray(0, ring.count * 16));
      flag(matrix, ring.count, 16);
      flag(decalAttr, ring.count, 4);
    }
    decalMesh.visible = ring.count > 0 || warm;
    decalMesh.count = ring.count > 0 ? ring.count : 1;
  }

  return {
    group,
    strike,
    update,
    strikes,
    radius: HIT_RADIUS,
    stats: () => ({ hits, parts: pool.active(), decals: ring.count, trails: trails.filter((t) => t.active).length }),
    pool,
    ring
  };
}

export {
  STRIKE_SPEED,
  HIT_RADIUS,
  MOMENTUM_KEEP,
  MAX_PARTS,
  MAX_DECALS,
  DECAL_LIFE,
  PART_DEFS,
  strikes,
  surfaceHeight,
  createRandom,
  createPartPool,
  createDecalRing,
  createPedestrianHits
};
