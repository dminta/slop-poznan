const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

let cityConfig;
let GEO;
let buildRoadNetwork;
let bridgesMod;
let camerasMod;

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
}

class Matrix4 {
  makeBasis(x, y, z) { return this; }
  setPosition(p) { return this; }
}

class MeshStandardNodeMaterial {
  constructor(opts) { Object.assign(this, opts); }
}

class Group {
  constructor() { this.children = []; }
  add(child) { this.children.push(child); }
}

class InstancedMesh {
  constructor(geo, mat, count) { this.instanceMatrix = {}; }
  setMatrixAt(i, m) {}
  computeBoundingSphere() {}
}

class Mesh {
  constructor(geo, mat) {}
}

class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class Float32BufferAttribute extends BufferAttribute {}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, attr) { this.attributes[name] = attr; }
  clone() { return new BufferGeometry(); }
  computeVertexNormals() {}
  applyMatrix4() {}
}

class BoxGeometry {}
class ExtrudeGeometry extends BufferGeometry { translate() {} }
class Shape { constructor() { this.holes = []; } }
class Path { constructor() {} }
class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }
class PerspectiveCamera {}

const makeNode = () => new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === 'toVar') return () => makeNode();
    return makeNode();
  },
  apply: () => makeNode()
});

test.before(async () => {
  cityConfig = await import('../js/city-config.js');
  ({ GEO } = await import('../js/geodata.js'));
  ({ buildRoadNetwork } = await import('../js/road-network.js'));

  const bridgesSrc = readFileSync(join(__dirname, '../js/bridges.js'), 'utf8');
  bridgesMod = loadModule(bridgesSrc, {
    imports: {
      'three/webgpu': {
        Vector3,
        Vector2,
        Matrix4,
        MeshStandardNodeMaterial,
        Group,
        InstancedMesh,
        Mesh,
        BufferGeometry,
        BufferAttribute,
        Float32BufferAttribute,
        BoxGeometry,
        ExtrudeGeometry,
        Shape,
        Path
      },
      'three/tsl': new Proxy({}, {
        get: (target, prop) => {
          if (prop === 'Fn') return (fn) => fn;
          return makeNode();
        }
      }),
      './tsl-materials.js': {
        cityUniforms: { uInteriorGlow: makeNode() },
        createRoadSurfaceMaterial: () => ({}),
        createSidewalkMaterial: () => ({}),
        createCurbMaterial: () => ({})
      },
      './city-config.js': cityConfig,
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: () => new BufferGeometry() }
    },
    globals: {
      console,
      performance: { now: () => Date.now() },
      Float32Array
    }
  });

  const camSrc = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');
  camerasMod = loadModule(camSrc, {
    imports: {
      'three/webgpu': { Vector3, PerspectiveCamera },
      './city-config.js': cityConfig
    },
    globals: { window: {}, document: {} }
  });
});

test('FOOTBRIDGES and BRIDGES define all three pedestrian crossings with correct geometry', () => {
  const { FOOTBRIDGES, BRIDGES } = cityConfig;
  assert.equal(FOOTBRIDGES.length, 3, 'FOOTBRIDGES contains exactly 3 footbridge definitions');

  const names = ['Most Biskupa Jordana', 'Kładka Bramy Poznania', 'Mosty Berdychowskie'];
  for (const name of names) {
    const fb = FOOTBRIDGES.find((b) => b.name === name);
    assert.ok(fb, `FOOTBRIDGES contains ${name}`);
    assert.equal(fb.footbridge, true, `${name} has footbridge flag`);

    const br = BRIDGES.find((b) => b.name === name);
    assert.ok(br, `BRIDGES contains ${name}`);
    assert.equal(br.footbridge, true, `BRIDGES entry for ${name} has footbridge flag`);
  }

  // Most Biskupa Jordana: 14 m wide single span
  const jordana = FOOTBRIDGES.find((b) => b.name === 'Most Biskupa Jordana');
  assert.equal(jordana.links.length, 1);
  const jLink = jordana.links[0];
  assert.equal(jLink.width, 14);
  assert.equal(jLink.lanes, 0);
  assert.equal(jLink.tram, false);
  assert.equal(jLink.footbridge, true);
  const jLen = Math.hypot(jLink.pts[1].x - jLink.pts[0].x, jLink.pts[1].z - jLink.pts[0].z);
  assert.ok(jLen >= 60 && jLen <= 70, `Most Jordana length ${jLen.toFixed(1)} m`);

  // Kładka Bramy Poznania: 4.3 m wide covered footbridge
  const brama = FOOTBRIDGES.find((b) => b.name === 'Kładka Bramy Poznania');
  assert.equal(brama.links.length, 1);
  const bLink = brama.links[0];
  assert.equal(bLink.width, 4.3);
  assert.equal(bLink.lanes, 0);
  assert.equal(bLink.tram, false);
  assert.equal(bLink.footbridge, true);
  const bLen = Math.hypot(bLink.pts[1].x - bLink.pts[0].x, bLink.pts[1].z - bLink.pts[0].z);
  assert.ok(bLen >= 60 && bLen <= 65, `Kładka Bramy Poznania length ${bLen.toFixed(1)} m`);

  // Mosty Berdychowskie: 3 linked segments across Warta and Cybina
  const berdych = FOOTBRIDGES.find((b) => b.name === 'Mosty Berdychowskie');
  assert.equal(berdych.links.length, 3);
  for (const l of berdych.links) {
    assert.equal(l.width, 6);
    assert.equal(l.lanes, 0);
    assert.equal(l.tram, false);
    assert.equal(l.footbridge, true);
  }

  // Check bridgeStructures in bridges.js
  const structures = bridgesMod.bridgeStructures();
  const sJordana = structures.find((s) => s.name === 'Most Biskupa Jordana');
  assert.ok(sJordana, 'Most Jordana structure exists');
  assert.equal(sJordana.kind, 'arch', 'Most Jordana is arch bridge');
  assert.equal(sJordana.footbridge, true, 'Most Jordana structure has footbridge flag');

  const sBrama = structures.find((s) => s.name === 'Kładka Bramy Poznania');
  assert.ok(sBrama, 'Kładka Bramy Poznania structure exists');
  assert.equal(sBrama.kind, 'covered', 'Kładka Bramy Poznania is covered bridge');
  assert.equal(sBrama.footbridge, true, 'Kładka Bramy Poznania structure has footbridge flag');

  const sBerdych = structures.filter((s) => s.name === 'Mosty Berdychowskie');
  assert.equal(sBerdych.length, 2, 'Mosty Berdychowskie split into 2 straight bridge spans');
  assert.ok(sBerdych.every((s) => s.kind === 'girder' && s.footbridge), 'Berdychowskie spans are girder footbridges');
});

test('Footbridge midpoints are walkable land (isLand === true) and not open water (isWater === false)', () => {
  const { isLand, isWater, distToWater, waterAt } = cityConfig;

  // Most Biskupa Jordana midpoint (under camera katedra at 1148, -336)
  assert.equal(isLand(1148, -336), true, 'Most Jordana midpoint is land');
  assert.equal(isWater(1148, -336), false, 'Most Jordana midpoint is not water');
  assert.equal(distToWater(1148, -336), 255, 'Most Jordana deck distance pinned to 255');
  assert.equal(waterAt(1148, -336)?.name, 'Cybina', 'waterAt identifies Cybina channel beneath Most Jordana');

  // Kładka Bramy Poznania midpoint
  const bMidX = (1117.0 + 1179.5) * 0.5;
  const bMidZ = (-429.2 + -424.5) * 0.5;
  assert.equal(isLand(bMidX, bMidZ), true, 'Kładka Bramy Poznania midpoint is land');
  assert.equal(isWater(bMidX, bMidZ), false, 'Kładka Bramy Poznania midpoint is not water');
  assert.equal(distToWater(bMidX, bMidZ), 255, 'Kładka Bramy Poznania distance pinned to 255');
  assert.equal(waterAt(bMidX, bMidZ)?.name, 'Cybina', 'waterAt identifies Cybina beneath Kładka Bramy Poznania');

  // Mosty Berdychowskie: western Warta span midpoint
  const wMidX = (756.9 + 922.2) * 0.5;
  const wMidZ = (330.0 + 323.6) * 0.5;
  assert.equal(isLand(wMidX, wMidZ), true, 'Mosty Berdychowskie Warta span midpoint is land');
  assert.equal(isWater(wMidX, wMidZ), false, 'Mosty Berdychowskie Warta span midpoint is not water');
  assert.equal(distToWater(wMidX, wMidZ), 255, 'Mosty Berdychowskie Warta distance pinned to 255');
  assert.equal(waterAt(wMidX, wMidZ)?.name, 'Warta', 'waterAt identifies Warta beneath west span');

  // Mosty Berdychowskie: eastern Cybina span midpoint
  const cMidX = (959.3 + 1048.7) * 0.5;
  const cMidZ = (322.5 + 398.2) * 0.5;
  assert.equal(isLand(cMidX, cMidZ), true, 'Mosty Berdychowskie Cybina span midpoint is land');
  assert.equal(isWater(cMidX, cMidZ), false, 'Mosty Berdychowskie Cybina span midpoint is not water');
  assert.equal(distToWater(cMidX, cMidZ), 255, 'Mosty Berdychowskie Cybina distance pinned to 255');
  assert.equal(waterAt(cMidX, cMidZ)?.name, 'Cybina', 'waterAt identifies Cybina beneath east span');
});

test('Footbridges do not affect the vehicular road network edge count or lane count', () => {
  const net = buildRoadNetwork([], []);
  assert.equal(net.edges.length, 8756, 'road network edge count matches baseline');
  const totalLanes = net.edges.reduce((sum, e) => sum + e.lanes.length, 0);
  assert.equal(totalLanes, 11650, 'total vehicular lanes count matches baseline');

  const fbNames = new Set(['Most Biskupa Jordana', 'Kładka Bramy Poznania', 'Mosty Berdychowskie']);
  for (const e of net.edges) {
    assert.ok(!fbNames.has(e.name), `Vehicular road edge should not be a footbridge: ${e.name}`);
  }
});

test('Footbridges generate edge colliders preventing players from falling into the river', () => {
  const scene = new Group();
  const { colliders } = bridgesMod.buildBridges(scene);

  const jColliders = colliders.filter((c) => c.minX > 1110 && c.maxX < 1185 && c.minZ > -350 && c.maxZ < -320);
  assert.ok(jColliders.length >= 2, `Most Jordana has ${jColliders.length} balustrade colliders`);
  for (const c of jColliders) {
    assert.ok(c.minX < c.maxX && c.minZ < c.maxZ, 'valid bounding box');
    assert.ok(c.maxY >= 1.0, 'collider height protects player');
    assert.ok(c.obb && c.obb.hx > 0 && c.obb.hz > 0, 'oriented bounding box defined');
  }

  const bColliders = colliders.filter((c) => c.minX > 1110 && c.maxX < 1185 && c.minZ > -440 && c.maxZ < -415);
  assert.ok(bColliders.length >= 2, `Kładka Bramy Poznania has ${bColliders.length} wall/edge colliders`);
  for (const c of bColliders) {
    assert.ok(c.minX < c.maxX && c.minZ < c.maxZ, 'valid bounding box');
    assert.ok(c.maxY >= 1.0, 'collider height protects player');
    assert.ok(c.obb && c.obb.hx > 0 && c.obb.hz > 0, 'oriented bounding box defined');
  }

  const bdColliders = colliders.filter((c) => c.minX > 750 && c.maxX < 1060 && c.minZ > 310 && c.maxZ < 410);
  assert.ok(bdColliders.length >= 4, `Mosty Berdychowskie has ${bdColliders.length} balustrade colliders`);
  for (const c of bdColliders) {
    assert.ok(c.minX < c.maxX && c.minZ < c.maxZ, 'valid bounding box');
    assert.ok(c.maxY >= 1.0, 'collider height protects player');
    assert.ok(c.obb && c.obb.hx > 0 && c.obb.hz > 0, 'oriented bounding box defined');
  }
});

test('katedra camera view on Most Jordana maintains an unobstructed line of sight to Archikatedra', () => {
  const { PLACE_VIEWS } = camerasMod;
  const { isLand, isWater, LANDMARK_SITES } = cityConfig;

  const view = PLACE_VIEWS.katedra;
  assert.ok(view, 'PLACE_VIEWS contains katedra preset');

  // Eye sits on Most Biskupa Jordana deck
  const eye = view.eye;
  assert.equal(eye.x, 1148, 'eye x on Most Jordana');
  assert.equal(eye.z, -336, 'eye z on Most Jordana');
  assert.ok(eye.y >= 3 && eye.y <= 12, `eye height ${eye.y} m above river/deck`);
  assert.equal(isLand(eye.x, eye.z), true, 'camera eye stands on land/bridge deck');
  assert.equal(isWater(eye.x, eye.z), false, 'camera eye is not in open water');

  // Target is Archikatedra św. Piotra i Pawła on Ostrów Tumski
  const look = view.look;
  const katSite = LANDMARK_SITES.Katedra;
  assert.ok(katSite, 'Katedra landmark site exists');
  const distToSiteCenter = Math.hypot(look.x - katSite.x, look.z - katSite.z);
  assert.ok(distToSiteCenter < 15, `look target is ${distToSiteCenter.toFixed(1)} m from Katedra center`);

  const rayDist = Math.hypot(look.x - eye.x, look.z - eye.z);
  assert.ok(rayDist >= 140 && rayDist <= 160, `camera distance to cathedral is ${rayDist.toFixed(1)} m`);

  // Line of sight heading: looking almost due west (dx negative, dz near 0)
  const dx = (look.x - eye.x) / rayDist;
  const dz = (look.z - eye.z) / rayDist;
  assert.ok(dx < -0.98, `direction vector points west (dx = ${dx.toFixed(3)})`);
  assert.ok(Math.abs(dz) < 0.1, `direction vector has minimal lateral skew (dz = ${dz.toFixed(3)})`);

  // Verify no other landmark site obstructs the direct line of sight between Most Jordana and Katedra
  for (const [name, site] of Object.entries(LANDMARK_SITES)) {
    if (name === 'Katedra') continue;
    const inXRange = site.x + site.w * 0.5 > Math.min(eye.x, look.x) && site.x - site.w * 0.5 < Math.max(eye.x, look.x);
    const inZRange = site.z + site.d * 0.5 > Math.min(eye.z, look.z) - 5 && site.z - site.d * 0.5 < Math.max(eye.z, look.z) + 5;
    assert.ok(!(inXRange && inZRange), `Landmark ${name} does not obstruct line of sight to Katedra`);
  }
});
