import * as THREE from 'three/webgpu';
import {
  float,
  vec2,
  vec3,
  uniform,
  uv,
  positionLocal,
  normalLocal,
  sin,
  abs,
  floor,
  fract,
  mod,
  max,
  mix,
  step,
  smoothstep,
  length,
  pow,
  exp,
  atan,
  acos
} from 'three/tsl';
import { cityUniforms, transparentEffectMRT } from './tsl-materials.js';

// js/baltyk-disco.js
// The night party on Bałtyk's 14th floor: an open-plan office behind the glazing of the south-south-east riser that
// faces the Międzynarodowe Targi Poznańskie, with a turning mirror ball and party lights. It is built for the room
// frame described in `landmarks-towers.js` (x along the glazing, y up, z out of the glass, the room at z < 0) and is
// pure emissive TSL: no scene light is created or toggled, the colours come from one time uniform.
//
// Cost: three meshes at night (the room shell, the mirror ball with its rod, the glass pane) plus a day wall that
// shows instead of them in daylight, so the daytime draw count is the facade's own. By day (uInteriorGlow below
// PARTY_ON_GLOW) the room, ball and pane are `visible = false` and the day wall, in the curtain-wall material of the
// rest of the tower, closes the opening.
//
// Rhythm (120 bpm): the whole room breathes once a beat between 55 % and 100 % brightness (a smooth
// pow(1 - fract(beat), 2.5) decay, 2 Hz, never off); a bar accent adds up to 25 % every four beats (0.5 Hz); the
// four party colours (magenta, cyan, green, amber) cross-fade every 2.5 s over 0.45 s. Nothing flashes faster than
// 2 Hz, and every spot shares the beat phase so the room never adds up to a faster flicker. The mirror ball's dots and
// facets twinkle at 0.4–1.0 Hz each, decorrelated in space.

// uInteriorGlow at which the party starts to show: below it everything is off and hidden. The night fade itself is
// smoothstep(0.7, 1.2, glow): 0 at golden hour (0.48) and midday (0.24), 1 at twilight (1.25) and midnight (1.55)
const PARTY_ON_GLOW = 0.62;
const PARTY_FADE_FROM = 0.7;
const PARTY_FADE_TO = 1.2;
const BEAT_HZ = 2.0;
const BALL_TURN = 0.38; // rad/s: one turn in 16.5 s
const BALL_RADIUS = 0.4;

// The JS twin of the shader's night fade, for the tests and the visibility switch
function partyLevel(glow) {
  const t = Math.min(1, Math.max(0, (glow - PARTY_FADE_FROM) / (PARTY_FADE_TO - PARTY_FADE_FROM)));
  return t * t * (3 - 2 * t);
}

const uTime = uniform(0.0);
const night = smoothstep(PARTY_FADE_FROM, PARTY_FADE_TO, cityUniforms.uInteriorGlow);
const beat = uTime.mul(BEAT_HZ);
// 0.55 … 1 each beat, plus a bar accent: the room's overall level
const level = float(0.55).add(pow(float(1.0).sub(fract(beat)), 2.5).mul(0.45))
  .mul(float(1.0).add(pow(float(1.0).sub(fract(beat.div(4.0))), 5.0).mul(0.25)));

const MAGENTA = vec3(1.0, 0.07, 0.72);
const CYAN = vec3(0.05, 0.85, 1.0);
const GREEN = vec3(0.12, 1.0, 0.25);
const AMBER = vec3(1.0, 0.58, 0.05);

// The i-th party colour (i any float node, wrapped to 0…4)
function palette(i) {
  const m = mod(i, 4.0);
  const w0 = float(1.0).sub(step(1.0, m));
  const w1 = step(1.0, m).mul(float(1.0).sub(step(2.0, m)));
  const w2 = step(2.0, m).mul(float(1.0).sub(step(3.0, m)));
  const w3 = step(3.0, m);
  return MAGENTA.mul(w0).add(CYAN.mul(w1)).add(GREEN.mul(w2)).add(AMBER.mul(w3));
}

// The colour a light with the given offset shows now: it holds one palette entry for 2.5 s, then cross-fades to the
// next in the last 0.45 s of each step
function colourAt(offset) {
  const phase = uTime.div(2.5);
  const a = floor(phase).add(offset);
  return mix(palette(a), palette(a.add(1.0)), smoothstep(0.82, 1.0, fract(phase)));
}

const hash21 = (a, b) => fract(sin(a.mul(127.1).add(b.mul(311.7))).mul(43758.5453));

// Ceiling spots: Lissajous paths over the ceiling, [centre x frac, amplitude x frac, rate x, phase x,
// amplitude z frac, rate z, phase z, radius m]; fractions are of the room's half-length / half-depth
const SPOTS = [
  [0.00, 0.80, 0.31, 0.0, 0.70, 0.43, 1.0, 0.50],
  [0.00, 0.85, 0.23, 2.1, 0.65, 0.37, 0.3, 0.42],
  [0.00, 0.75, 0.41, 4.2, 0.75, 0.29, 2.7, 0.46],
  [0.00, 0.80, 0.27, 5.5, 0.60, 0.47, 4.4, 0.40],
  [0.00, 0.70, 0.35, 1.3, 0.70, 0.33, 5.1, 0.44]
];

// The mirror ball's light: dots on a latitude/longitude grid of the ball's own frame, turned with it. A surface point
// at offset d from the ball lies in the grid cell given by its polar angle and (turned) azimuth; the dot is a soft disc
// in angle, so it grows with distance and stretches on grazing walls as the real ones do
function mirrorBallDots(p, ball) {
  const d = p.sub(ball);
  const r = length(d);
  const theta = acos(d.y.div(r));
  const RINGS = 9;
  const ringF = theta.mul(RINGS / Math.PI);
  const ring = floor(ringF);
  const sinC = sin(ring.add(0.5).mul(Math.PI / RINGS));
  const nAz = max(floor(sinC.mul(22.0).add(0.5)), 4.0);
  const phi = atan(d.z, d.x).sub(uTime.mul(BALL_TURN)).div(2.0 * Math.PI);
  const azF = fract(phi).mul(nAz);
  const cell = floor(azF);
  const dphi = azF.sub(cell).sub(0.5).mul(2.0 * Math.PI).div(nAz).mul(sinC);
  const dtheta = ringF.sub(ring).sub(0.5).mul(Math.PI / RINGS);
  const dist = length(vec2(dtheta, dphi));
  const h = hash21(cell.add(ring.mul(37.0)), ring);
  const dot = smoothstep(0.1, 0.045, dist).mul(step(0.3, h));
  const twinkle = sin(uTime.mul(float(2.5).add(h.mul(3.7))).add(h.mul(61.0))).mul(0.5).add(0.5).mul(0.7).add(0.3);
  const reach = float(1.7).div(float(1.0).add(r.mul(r).mul(0.05)));
  return colourAt(floor(h.mul(4.0))).mul(dot).mul(twinkle).mul(reach);
}

// The room shell: ceiling, floor, back wall and side walls in one mesh, told apart by their outward normal (the
// material draws the inside, BackSide, so the glazing side is culled). All lights are drawn here, in room coordinates
function createRoomMaterial({ x0, x1, depth, floorY, ceilY, ball }) {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const p = positionLocal;
  const n = normalLocal;
  const xc = (x0 + x1) / 2;
  const hx = (x1 - x0) / 2;
  const zc = -depth / 2;
  const hz = depth / 2;
  const H = ceilY - floorY;
  const dots = mirrorBallDots(p, vec3(ball[0], ball[1], ball[2]));

  // Ceiling spots, shared by the ceiling (full strength) and the floor (a dim echo)
  let spots = vec3(0.0, 0.0, 0.0);
  SPOTS.forEach(([cx, ax, wx, px, az, wz, pz, radius], i) => {
    const cxn = float(xc + cx * hx).add(sin(uTime.mul(wx).add(px)).mul(ax * hx));
    const czn = float(zc).add(sin(uTime.mul(wz).add(pz)).mul(az * hz));
    const dd = length(vec2(p.x.sub(cxn), p.z.sub(czn)));
    spots = spots.add(colourAt(float(i)).mul(smoothstep(radius, radius * 0.3, dd)));
  });

  const ceiling = vec3(0.012, 0.016, 0.03)
    .add(colourAt(float(0)).mul(0.14).mul(level))
    .add(spots.mul(1.5).mul(level))
    .add(dots.mul(1.1));
  const floorC = vec3(0.01, 0.012, 0.02)
    .add(colourAt(float(3)).mul(0.05).mul(level))
    .add(spots.mul(0.22).mul(level))
    .add(dots.mul(0.45));

  // Back wall: two sweeping fans of light (a soft vertical band, brightest at the ceiling), over a wash
  const up = p.y.sub(floorY).div(H);
  const fan = (rate, phase, k) => {
    const bx = float(xc).add(sin(uTime.mul(rate).add(phase)).mul(hx * 0.85));
    const dx = p.x.sub(bx);
    return colourAt(float(k)).mul(exp(dx.mul(dx).mul(-1.0 / (2 * 0.5 * 0.5)))).mul(mix(0.35, 1.0, up));
  };
  const back = vec3(0.012, 0.016, 0.03)
    .add(colourAt(float(2)).mul(0.2).mul(level).mul(mix(0.5, 1.0, up)))
    .add(fan(0.52, 0.0, 1).add(fan(0.37, 3.1, 3)).mul(1.2).mul(level))
    .add(dots.mul(0.9));
  const side = vec3(0.012, 0.016, 0.03)
    .add(colourAt(float(1)).mul(0.22).mul(level).mul(mix(0.5, 1.0, up)))
    .add(dots.mul(0.9));

  const wCeil = step(0.5, n.y);
  const wFloor = step(0.5, n.y.mul(-1.0));
  const wBack = step(0.5, n.z.mul(-1.0));
  const wSide = step(0.5, abs(n.x));
  const colour = ceiling.mul(wCeil).add(floorC.mul(wFloor)).add(back.mul(wBack)).add(side.mul(wSide));
  mat.colorNode = colour.mul(night);
  return mat;
}

// The mirror ball: a latitude/longitude grid of facets that turn with the ball; each facet glints in the party
// colour of its hash when its slow phase peaks
function createBallMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial();
  const q = uv();
  const turned = q.x.add(uTime.mul(BALL_TURN / (2.0 * Math.PI)));
  const gx = turned.mul(20.0);
  const gy = q.y.mul(10.0);
  const cx = floor(gx);
  const cy = floor(gy);
  const h = hash21(cx, cy);
  const edge = step(0.06, fract(gx)).mul(step(0.06, fract(gy))); // the dark joints between the mirror tiles
  const glint = pow(max(sin(uTime.mul(float(2.0).add(h.mul(2.0))).add(h.mul(41.0))), 0.0), 8.0);
  const tile = vec3(0.1, 0.11, 0.13).add(colourAt(floor(h.mul(4.0))).mul(float(0.3).add(glint.mul(2.2)).mul(level)));
  mat.colorNode = tile.mul(edge).mul(night);
  return mat;
}

// The glazing: a mostly clear pane with a dark spandrel band at the sill, a head band and vertical mullions at the
// curtain wall's 1.8 m, tinted faintly by the room's wash. Transparent like the tram shelters' glass, so it keeps the
// MRT of what is behind it
function createPaneMaterial({ length: len, height }) {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0x1c2a36, roughness: 0.06, metalness: 0.2, transparent: true, depthWrite: false
  });
  mat.mrtNode = transparentEffectMRT;
  const q = uv();
  const mx = q.x.mul(len);
  const my = q.y.mul(height);
  const bays = Math.max(1, Math.round(len / 1.8));
  const pitch = len / bays;
  const mullion = step(abs(mod(mx.add(pitch / 2), pitch).sub(pitch / 2)), 0.035); // within 3.5 cm of a bay line
  const sill = step(my, 0.32);
  const head = step(height - 0.22, my);
  const frame = max(max(mullion, sill), head);
  mat.opacityNode = mix(float(0.16), float(0.96), frame);
  mat.colorNode = mix(vec3(0.07, 0.1, 0.13), vec3(0.1, 0.1, 0.11), frame);
  mat.emissiveNode = colourAt(float(0)).mul(0.1).mul(level).mul(night).mul(float(1.0).sub(frame));
  return mat;
}

// Builds the party in the room frame. `room`: x0, x1 (along the glazing), depth (into the building), floorY and
// ceilY (absolute heights). `dayMaterial` is the tower's curtain wall, drawn over the opening by day.
function createBaltykDisco({ room, dayMaterial }) {
  const { x0, x1, depth, floorY, ceilY } = room;
  const span = x1 - x0;
  const height = ceilY - floorY;
  const group = new THREE.Group();
  group.name = 'BaltykDisco';

  // The room shell
  const ballY = ceilY - 0.55 - BALL_RADIUS;
  const ball = [(x0 + x1) / 2, ballY, -depth / 2];
  const shell = new THREE.BoxGeometry(span, height, depth);
  shell.translate((x0 + x1) / 2, (floorY + ceilY) / 2, -depth / 2);
  const roomMesh = new THREE.Mesh(shell, createRoomMaterial({ x0, x1, depth, floorY, ceilY, ball }));
  roomMesh.name = 'BaltykDiscoRoom';

  // The ball and its rod, merged into one geometry
  const sphere = new THREE.SphereGeometry(BALL_RADIUS, 24, 14);
  sphere.translate(ball[0], ball[1], ball[2]);
  const rodLength = ceilY - 0.02 - (ball[1] + BALL_RADIUS);
  const rod = new THREE.CylinderGeometry(0.012, 0.012, rodLength, 5);
  rod.translate(ball[0], ball[1] + BALL_RADIUS + rodLength / 2, ball[2]);
  const ballMesh = new THREE.Mesh(mergeGeometries(sphere, rod), createBallMaterial());
  ballMesh.name = 'BaltykDiscoBall';

  // The glass pane in the plane of the glazing
  const paneGeo = new THREE.PlaneGeometry(span, height);
  paneGeo.translate((x0 + x1) / 2, (floorY + ceilY) / 2, 0.0);
  const pane = new THREE.Mesh(paneGeo, createPaneMaterial({ length: span, height }));
  pane.name = 'BaltykDiscoPane';
  pane.renderOrder = 2;

  // The daytime wall: the curtain wall over the same opening, 0.3 m thick behind the glazing line
  const wallGeo = new THREE.BoxGeometry(span, height, 0.3);
  wallGeo.translate((x0 + x1) / 2, (floorY + ceilY) / 2, -0.15);
  const dayWall = new THREE.Mesh(wallGeo, dayMaterial);
  dayWall.name = 'BaltykDiscoDayWall';
  // It casts no shadow: the core's glazing wall stands 6.4 m behind it and shades the same ground, and a caster of its
  // own would add the cascades' draws to the day count
  dayWall.castShadow = false;
  dayWall.receiveShadow = true;

  const nightMeshes = [roomMesh, ballMesh, pane];
  for (const m of nightMeshes) {
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  }
  group.add(dayWall);

  // Everything starts visible so precompileShaders() compiles the night pipelines behind the loading screen; the
  // first update hides them by day
  let on = true;
  const update = (dt, elapsed) => {
    const glow = cityUniforms.uInteriorGlow.value;
    const nowOn = glow > PARTY_ON_GLOW;
    if (nowOn !== on) {
      on = nowOn;
      for (const m of nightMeshes) m.visible = on;
      dayWall.visible = !on;
    }
    if (on) uTime.value = elapsed;
  };

  return { group, update, nightMeshes, dayWall, ball };
}

// Two indexed geometries (position, normal, uv) as one
function mergeGeometries(a, b) {
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const A = a.getAttribute(name);
    const B = b.getAttribute(name);
    const data = new Float32Array(A.array.length + B.array.length);
    data.set(A.array, 0);
    data.set(B.array, A.array.length);
    merged.setAttribute(name, new THREE.BufferAttribute(data, A.itemSize));
  }
  const ia = a.index.array;
  const ib = b.index.array;
  const offset = a.getAttribute('position').count;
  const index = new Uint32Array(ia.length + ib.length);
  index.set(ia, 0);
  for (let i = 0; i < ib.length; i++) index[ia.length + i] = ib[i] + offset;
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

export { createBaltykDisco, partyLevel, PARTY_ON_GLOW, PARTY_FADE_FROM, PARTY_FADE_TO, BEAT_HZ };
