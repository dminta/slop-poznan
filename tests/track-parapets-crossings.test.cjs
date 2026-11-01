const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

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

class Group {
  constructor() { this.children = []; }
  add(child) { this.children.push(child); }
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
  clone() { const b = new BufferGeometry(); b.attributes = { ...this.attributes }; return b; }
  computeVertexNormals() {}
  applyMatrix4() {}
  deleteAttribute(k) { delete this.attributes[k]; }
}

class BoxGeometry {}
class ExtrudeGeometry extends BufferGeometry { translate() {} }
class Shape { constructor() { this.holes = []; } }
class Path { constructor() {} }
class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }

const makeNode = () => new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === 'toVar') return () => makeNode();
    return makeNode();
  },
  apply: () => makeNode()
});

let cityConfig;
let GEO;
let bridgesMod;
let tramInfraMod;
let network;
let railLayout;

test.before(async () => {
  cityConfig = await import('../js/city-config.js');
  ({ GEO } = await import('../js/geodata.js'));

  const bridgesSrc = readFileSync(join(__dirname, '../js/bridges.js'), 'utf8');
  bridgesMod = loadModule(bridgesSrc, {
    imports: {
      'three/webgpu': {
        Vector3,
        Vector2,
        Matrix4,
        MeshStandardNodeMaterial: class { constructor(o) { Object.assign(this, o); } },
        Group,
        InstancedMesh: class { constructor() { this.instanceMatrix = {}; } computeBoundingSphere() {} setMatrixAt() {} },
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
      './geodata.js': { GEO },
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: () => null }
    },
    globals: { console, performance: { now: () => Date.now() }, Float32Array }
  });

  const { buildRoadNetwork } = loadModule(readFileSync(join(__dirname, '../js/road-network.js'), 'utf8'), {
    imports: { './city-config.js': cityConfig, './geodata.js': { GEO } },
    globals: { console: { info() {} } },
    filename: 'road-network.js'
  });
  network = buildRoadNetwork([], []);

  const tiSource = readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8');
  tramInfraMod = loadModule(tiSource, {
    imports: {
      'three/webgpu': inert(),
      'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(),
      './tsl-materials.js': inert(),
      './city-config.js': cityConfig,
      './geodata.js': { GEO }
    },
    globals: { Math, Object, Array, Set, Map, Number, Float32Array, Float64Array, console: { info() {}, warn() {} }, document: inert() },
    filename: 'tram-infra.js'
  });
  railLayout = tramInfraMod.layoutRailInfrastructure(network);
});

test('parapetPieces cuts gaps with min 2.0 m margin for tram tracks and min 2.4 m for rail tracks', () => {
  const f = {
    L: 100,
    dir: new Vector3(1, 0, 0),
    side: new Vector3(0, 0, 1),
    at: (t, s) => new Vector3(t * 100, 0, s)
  };

  // Test custom perpendicular crossing tram track at x = 50 (s from -10 to +10)
  const customTramTrack = { pts: [{ x: 50, z: -10 }, { x: 50, z: 10 }] };
  const piecesTram = bridgesMod.parapetPieces(f, 5, 10, 90, { tramTracks: [customTramTrack], railTracks: [] });
  // Gap should be cut around x = 50 with margin >= 2.0 m
  assert.equal(piecesTram.length, 2, 'parapet cut into two pieces by crossing tram track');
  assert.ok(piecesTram[0][1] <= 48.0, `piece 0 ends at or before 48.0 m (got ${piecesTram[0][1]})`);
  assert.ok(piecesTram[1][0] >= 52.0, `piece 1 starts at or after 52.0 m (got ${piecesTram[1][0]})`);

  // Test custom perpendicular crossing rail track at x = 50
  const customRailTrack = { pts: [{ x: 50, z: -10 }, { x: 50, z: 10 }] };
  const piecesRail = bridgesMod.parapetPieces(f, 5, 10, 90, { tramTracks: [], railTracks: [customRailTrack] });
  assert.equal(piecesRail.length, 2, 'parapet cut into two pieces by crossing rail track');
  assert.ok(piecesRail[0][1] <= 47.6, `piece 0 ends at or before 47.6 m (got ${piecesRail[0][1]})`);
  assert.ok(piecesRail[1][0] >= 52.4, `piece 1 starts at or after 52.4 m (got ${piecesRail[1][0]})`);
});

test('parapets and bridge colliders do not block tram or rail tracks on Most Dworcowy, Teatralny, Uniwersytecki', () => {
  const scene = new Group();
  const { colliders } = bridgesMod.buildBridges(scene);

  const overpassBoxes = [
    { name: 'Most Dworcowy', minX: -1560, maxX: -1330, minZ: 540, maxZ: 620 },
    { name: 'Most Teatralny', minX: -1380, maxX: -1260, minZ: -220, maxZ: -170 },
    { name: 'Most Uniwersytecki', minX: -1450, maxX: -1320, minZ: 50, maxZ: 130 }
  ];

  const overpassColliders = colliders.filter((c) => {
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) / 2;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) / 2;
    return overpassBoxes.some((b) => cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ);
  });
  assert.ok(overpassColliders.length > 0, 'overpass colliders generated');

  const tramTracks = cityConfig.RAIL.filter((r) => r.kind === 'tram');
  const railTracks = cityConfig.RAIL.filter((r) => r.kind === 'rail');

  for (const c of overpassColliders) {
    const cx = c.obb ? c.obb.cx : (c.minX + c.maxX) / 2;
    const cz = c.obb ? c.obb.cz : (c.minZ + c.maxZ) / 2;

    for (const tr of tramTracks) {
      for (let i = 0; i + 1 < tr.pts.length; i++) {
        const a = tr.pts[i], b = tr.pts[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z;
        const lenSq = ex * ex + ez * ez;
        if (lenSq < 1e-4) continue;
        const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cz - a.z) * ez) / lenSq));
        const d = Math.hypot(a.x + ex * t - cx, a.z + ez * t - cz);
        assert.ok(d >= 1.6, `overpass collider at (${cx.toFixed(1)}, ${cz.toFixed(1)}) stands clear of tram track (d=${d.toFixed(2)} m)`);
      }
    }

    for (const tr of railTracks) {
      for (let i = 0; i + 1 < tr.pts.length; i++) {
        const a = tr.pts[i], b = tr.pts[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z;
        const lenSq = ex * ex + ez * ez;
        if (lenSq < 1e-4) continue;
        const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cz - a.z) * ez) / lenSq));
        const d = Math.hypot(a.x + ex * t - cx, a.z + ez * t - cz);
        assert.ok(d >= 2.0, `overpass collider at (${cx.toFixed(1)}, ${cz.toFixed(1)}) stands clear of rail track (d=${d.toFixed(2)} m)`);
      }
    }
  }
});

test('railway crossing sites are cleanly cut out of the corridor keep-out raster', () => {
  const { corridor, roadDist, level } = railLayout;

  assert.equal(level.length, 0, 'zero flush ground track pieces');

  // All 5 former crossing sites have unobstructed roadways
  const sites = [
    { street: 'Świętego Michała', x: 2155, z: -850 },
    { street: 'Krańcowa', x: 2873, z: -1222 },
    { street: 'Bałtycka', x: 3088, z: -1976 },
    { street: 'Gdyńska', x: 3028, z: -2090 },
    { street: 'Wrzesińska', x: 3636, z: -1108 }
  ];

  for (const cs of sites) {
    let blockedInRoad = 0;
    for (let iz = Math.floor(cs.z - 30); iz <= Math.floor(cs.z + 30); iz++) {
      for (let ix = Math.floor(cs.x - 30); ix <= Math.floor(cs.x + 30); ix++) {
        const x = ix + 0.5;
        const z = iz + 0.5;
        if (roadDist(x, z) < 1.5 && corridor.has(x, z)) {
          blockedInRoad++;
        }
      }
    }
    assert.equal(blockedInRoad, 0, `crossing on ${cs.street} has 0 blocked roadway cells`);
  }
});

test('cars can drive across all railway underpasses and former crossings without being stopped by keepOutOfCorridor', () => {
  const { corridor } = railLayout;
  const ctrlSource = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

  const { ThirdPersonControllerManager } = loadModule(ctrlSource, {
    globals: { window: {}, document: { hidden: false } },
    imports: {
      'three/webgpu': inert(),
      './city-config.js': cityConfig,
      './tsl-materials.js': inert(),
      './actor-models.js': inert(),
      './pedestrians.js': inert(),
      './vehicle-lights.js': inert()
    }
  });

  const controller = Object.create(ThirdPersonControllerManager.prototype);
  controller.keepOut = corridor.has;

  // Test across all 5 former crossings: driving along edges that cross the tracks
  const sites = [
    { street: 'Świętego Michała', center: { x: 2155, z: -850 } },
    { street: 'Krańcowa', center: { x: 2873, z: -1222 } },
    { street: 'Bałtycka', center: { x: 3088, z: -1976 } },
    { street: 'Gdyńska', center: { x: 3028, z: -2090 } },
    { street: 'Wrzesińska', center: { x: 3636, z: -1108 } }
  ];

  let testedCrossingEdges = 0;
  for (const cs of sites) {
    const c = cs.center;
    const nearEdges = network.edges.filter((e) => {
      const mx = e.x0 + (e.dx * e.span) / 2;
      const mz = e.z0 + (e.dz * e.span) / 2;
      return Math.hypot(mx - c.x, mz - c.z) < 50;
    });

    for (const e of nearEdges) {
      testedCrossingEdges++;
      const carEntity = { speed: 12.0, vx: e.dx * 12.0, vz: e.dz * 12.0 };
      for (const o of e.lanes) {
        for (let s = 0; s <= e.span; s += 2) {
          const pos = { x: e.x0 + e.dx * s + e.rx * o, z: e.z0 + e.dz * s + e.rz * o };
          controller.keepOutOfCorridor(pos, carEntity);
          assert.equal(carEntity.speed, 12.0, `car speed preserved at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) on ${cs.street}`);
        }
      }
    }
  }

  assert.ok(testedCrossingEdges >= 10, `tested at least 10 crossing edges (tested ${testedCrossingEdges})`);
});
