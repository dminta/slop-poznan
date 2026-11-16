// tests/baltyk-disco.test.cjs
// The night party on Bałtyk's 14th floor (js/baltyk-disco.js, placed by js/landmarks-towers.js): the room's height and
// façade (the riser facing the Targi), that it stands behind the glass, clear of the 15th-floor terrace camera, and that
// it is off at golden hour and midday and on at twilight and midnight. The shader look needs a browser.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const cityConfig = require('../js/city-config.js');
const { LANDMARK_SITES } = cityConfig;
const read = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');

// A node-graph stub: every call and member access answers with the same chainable value
function chain() {
  const fn = function () {};
  const proxy = new Proxy(fn, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : proxy),
    apply: () => proxy
  });
  return proxy;
}
const tslStub = new Proxy({}, { get: () => chain() });

// Just enough geometry for baltyk-disco.js: a vertex list with attributes, translate and an index
class Geometry {
  constructor(vertexCount) {
    this.attributes = {
      position: { array: new Float32Array(vertexCount * 3), itemSize: 3, count: vertexCount },
      normal: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
      uv: { array: new Float32Array(vertexCount * 2), itemSize: 2 }
    };
    this.index = { array: new Uint16Array([0, 1, 2]) };
  }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  setIndex(attr) { this.index = attr; }
  translate() { return this; }
}
const fakeThree = {
  ...THREE,
  BoxGeometry: class extends Geometry { constructor() { super(24); } },
  PlaneGeometry: class extends Geometry { constructor() { super(4); } },
  SphereGeometry: class extends Geometry { constructor() { super(100); } },
  CylinderGeometry: class extends Geometry { constructor() { super(20); } },
  BufferGeometry: class extends Geometry { constructor() { super(0); } },
  BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
  MeshBasicNodeMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  MeshStandardNodeMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  BackSide: 1
};

const cityUniforms = { uInteriorGlow: { value: 0.24 } };
const disco = loadModule(read('baltyk-disco.js'), {
  imports: {
    'three/webgpu': fakeThree,
    'three/tsl': tslStub,
    './tsl-materials.js': { cityUniforms, transparentEffectMRT: {} }
  },
  globals: { Math }
});

const tslMaterialsStub = {
  createPreWarBuildingMaterial: (o) => ({ ...o }),
  createCurtainWallMaterial: (o) => ({ ...o }),
  createFacadeBoxes: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), {}),
  createLitWindowMaterial: () => new THREE.MeshStandardNodeMaterial({ color: 0x1c2a36 })
};
const kit = loadModule(read('landmark-kit.js'), {
  imports: { 'three/webgpu': THREE, './city-config.js': cityConfig, './tsl-materials.js': tslMaterialsStub },
  globals: { Math, console }
});
const towers = loadModule(read('landmarks-towers.js'), {
  imports: { 'three/webgpu': THREE, './landmark-kit.js': kit, './baltyk-disco.js': disco },
  globals: { Math, console }
});

const L = 67 / 17;
const site = LANDMARK_SITES['Bałtyk'];
const cs = Math.cos(site.ang);
const sn = Math.sin(site.ang);
// A point of the model's frame in world coordinates (the tower stands at scale 1, turned by the site's ang)
const toWorld = (x, z) => [site.x + x * cs + z * sn, site.z - x * sn + z * cs];

function buildTower() {
  const group = new THREE.Group();
  const dynamic = new THREE.Group();
  const update = towers.buildTowerLandmarks({ group, dynamic, colliders: [], M: kit.createLandmarkMaterials() });
  dynamic.updateMatrixWorld(true);
  const mount = dynamic.children.find((c) => c.name === 'BaltykDiscoMount');
  assert.ok(mount, 'the party is mounted in the dynamic root');
  return { group, dynamic, mount, update, room: mount.children[0] };
}

test('the room is on the 14th floor (ground floor = 0): 55.2–59.1 m, under the roof slab', () => {
  const { room } = buildTower();
  const frame = towers.baltykDiscoFrame();
  assert.equal(towers.BALTYK_DISCO_FLOOR, 14);
  assert.ok(Math.abs(frame.room.floorY - 14 * L) < 1e-9, `floor ${frame.room.floorY} m is level 14's slab at ${14 * L} m`);
  // The opening ends under the 0.45 m roof slab of the part, so the 15th-floor terrace deck (15 × 3.94 = 59.1 m) is above
  assert.ok(Math.abs(frame.room.ceilY - (15 * L - 0.45)) < 1e-9);
  assert.ok(frame.room.ceilY < 15 * L && frame.room.floorY >= 14 * L);
  assert.ok(room.children.length === 4, 'the room, ball, pane and day wall are mounted');
});

test('the glazing is the south-south-east riser, the one facing the Targi, and the room stands behind it', () => {
  const { room } = buildTower();
  const frame = towers.baltykDiscoFrame();
  const mid = (frame.room.x0 + frame.room.x1) / 2;
  // Room frame -> world: the group's matrix, applied to the glazing centre and to a point 1 m out of the glass
  const at = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z);
    v.applyMatrix4(room.matrixWorld);
    return v;
  };
  const glass = at(mid, 57, 0);
  const out = at(mid, 57, 1);
  const normal = [out.x - glass.x, out.z - glass.z];
  assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6, 'the room frame is not scaled');
  // World bearing of the glazing normal (from north, clockwise; +z is south) and of the Iglica, the Targi's landmark
  const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const facing = bearing(...normal);
  const iglica = LANDMARK_SITES['Iglica'];
  const toTargi = bearing(iglica.x - glass.x, iglica.z - glass.z);
  assert.ok(Math.abs(facing - 154) < 1.5, `the glazing faces ${facing.toFixed(1)}° (south-south-east)`);
  assert.ok(Math.abs(toTargi - 204) < 2, `the Iglica lies at ${toTargi.toFixed(1)}° from the glazing`);
  const dot = (normal[0] * (iglica.x - glass.x) + normal[1] * (iglica.z - glass.z)) / Math.hypot(iglica.x - glass.x, iglica.z - glass.z);
  assert.ok(dot > 0.6, `the glazing looks towards the Targi (cos ${dot.toFixed(2)})`);

  // Of the walls the storey shows, no short end faces the Targi better: the west ends face 270° (66° off)
  const west = BALTYK_WEST_END();
  assert.ok(dot > west, `the riser (cos ${dot.toFixed(2)}) beats the west end (cos ${west.toFixed(2)})`);

  // The glazing is the party part's real plan edge, and the room is behind it (the room's z < 0 side) ...
  const plan = towers.BALTYK_PARTS[towers.BALTYK_DISCO_PART][2];
  const a = toWorld(...plan[3]);
  const b = toWorld(...plan[2]);
  const along = [b[0] - a[0], b[1] - a[1]];
  const cross = Math.abs((glass.x - a[0]) * along[1] - (glass.z - a[1]) * along[0]) / Math.hypot(...along);
  assert.ok(cross < 0.01, `the glazing centre is ${cross.toFixed(3)} m off the plan edge`);
  const back = at(mid, 57, -frame.room.depth);
  const inward = [back.x - glass.x, back.z - glass.z];
  assert.ok(inward[0] * normal[0] + inward[1] * normal[1] < -frame.room.depth + 1e-6, 'the back wall is deeper than the glass');
  assert.ok(frame.room.depth > 5 && frame.room.depth < 7, `the room is ${frame.room.depth.toFixed(2)} m deep`);
});

function BALTYK_WEST_END() {
  // Short south-west end of the party part: plan[3] -> plan[0], its outward normal turned to world
  const plan = towers.BALTYK_PARTS[towers.BALTYK_DISCO_PART][2];
  const [p3, p0] = [plan[3], plan[0]];
  const len = Math.hypot(p0[0] - p3[0], p0[1] - p3[1]);
  let n = [-(p0[1] - p3[1]) / len, (p0[0] - p3[0]) / len];
  const centre = plan.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  if ((centre[0] - p3[0]) * n[0] + (centre[1] - p3[1]) * n[1] > 0) n = [-n[0], -n[1]];
  const w = [n[0] * cs + n[1] * sn, -n[0] * sn + n[1] * cs];
  const g = toWorld(...p3);
  const iglica = LANDMARK_SITES['Iglica'];
  const d = [iglica.x - g[0], iglica.z - g[1]];
  return (w[0] * d[0] + w[1] * d[1]) / Math.hypot(...d);
}

test('the room fits inside the tower, keeps clear of the terrace camera and of the opaque ends', () => {
  const frame = towers.baltykDiscoFrame();
  const { x0, x1, depth } = frame.room;
  const [ox, oz] = frame.origin;
  const local = (x, z) => [ox + frame.edge[0] * x + frame.normal[0] * z, oz + frame.edge[1] * x + frame.normal[1] * z];
  const inside = (plan, [px, pz], margin) => {
    // Convex plan, either winding: the point is on one side of every edge, at least `margin` m in
    let sign = 0;
    for (let i = 0; i < plan.length; i++) {
      const a = plan[i];
      const b = plan[(i + 1) % plan.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d = ((b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0])) / len;
      if (Math.abs(d) < margin) return false;
      const s = Math.sign(d);
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  };
  const p15 = towers.BALTYK_PARTS[towers.BALTYK_DISCO_PART][2];
  const p16 = towers.BALTYK_PARTS[towers.BALTYK_DISCO_NEIGHBOUR][2];
  // The strip of the glazing, 0.15 m in; then each back corner, which must lie in the [16, 0] strip or the core
  const front = [local(x0, -0.15), local(x1, -0.15)];
  for (const p of front) assert.ok(inside(p15, p, 0.02), 'the room starts inside the party part');
  const core = towers.BALTYK_PARTS[0][2];
  for (const p of [local(x0, -depth), local(x1, -depth)]) {
    assert.ok(inside(p16, p, 0.05) || inside(core, p, 0.0), `back corner ${p.map((v) => v.toFixed(2))} is inside the tower`);
  }
  // Opaque curtain wall stays at both ends of the 25.7 m riser
  assert.ok(x0 >= 4 && frame.length - x1 >= 4, `${x0} m and ${(frame.length - x1).toFixed(1)} m of wall at the ends`);

  // The "Taras Bałtyku" camera stands on the 59.1 m deck, above the room's roof, so it never looks into it
  const camera = loadModule(read('cameras.js'), {
    imports: { 'three/webgpu': THREE, './city-config.js': cityConfig },
    globals: { Math }
  });
  const eye = camera.PLACE_VIEWS.baltyk.eye;
  assert.ok(eye.y > frame.room.ceilY + 0.45, `the camera at ${eye.y.toFixed(2)} m is on the deck above the ${frame.room.ceilY.toFixed(2)} m ceiling`);
});

test('the party is hidden by day and shown, fading in smoothly, at twilight and midnight', () => {
  const presets = {};
  const lighting = readFileSync(join(__dirname, '../js/lighting.js'), 'utf8');
  for (const id of ['golden', 'midday', 'twilight', 'midnight']) {
    const m = new RegExp(`${id}: \\{[\\s\\S]*?interiorGlow: ([\\d.]+)`).exec(lighting);
    assert.ok(m, `${id} preset has an interiorGlow`);
    presets[id] = Number(m[1]);
  }
  assert.equal(disco.partyLevel(presets.golden), 0);
  assert.equal(disco.partyLevel(presets.midday), 0);
  assert.equal(disco.partyLevel(presets.twilight), 1);
  assert.equal(disco.partyLevel(presets.midnight), 1);
  // Smooth in between, monotonic, and exactly dark where the meshes appear
  assert.equal(disco.partyLevel(disco.PARTY_ON_GLOW), 0);
  let last = 0;
  for (let g = 0.4; g <= 1.6; g += 0.02) {
    const v = disco.partyLevel(g);
    assert.ok(v >= last - 1e-12 && v <= 1, `monotonic at ${g.toFixed(2)}`);
    assert.ok(v - last < 0.1, `no jump at ${g.toFixed(2)}`);
    last = v;
  }

  // The visibility switch follows uInteriorGlow
  const built = disco.createBaltykDisco({ room: towers.baltykDiscoFrame().room, dayMaterial: {} });
  const dayWall = built.dayWall;
  for (const [glow, night] of [[presets.midday, false], [presets.golden, false], [presets.twilight, true], [presets.midnight, true], [presets.midday, false]]) {
    cityUniforms.uInteriorGlow.value = glow;
    built.update(0.016, 1);
    for (const m of built.nightMeshes) assert.equal(m.visible, night, `glow ${glow}: ${m.name} visible = ${night}`);
    assert.equal(dayWall.visible, !night, `glow ${glow}: the day wall shows by day`);
  }
});

test('the rhythm stays at or under 3 Hz', () => {
  assert.ok(disco.BEAT_HZ <= 3, `${disco.BEAT_HZ} Hz beat`);
  const source = read('baltyk-disco.js');
  assert.match(source, /const BEAT_HZ = 2\.0;/);
});
