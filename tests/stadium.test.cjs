const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const cityConfig = require('../js/city-config.js');
const { LANDMARK_SITES } = cityConfig;

const source = (name) => readFileSync(join(__dirname, `../js/${name}.js`), 'utf8');

const tslStub = {
  createPreWarBuildingMaterial: (o) => ({ ...o }),
  createCurtainWallMaterial: (o) => ({ ...o }),
  createFacadeBoxes: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), {}),
  createLitWindowMaterial: () => ({})
};

const kit = loadModule(source('landmark-kit'), {
  imports: { 'three/webgpu': THREE, './city-config.js': cityConfig, './tsl-materials.js': tslStub },
  globals: { Math, console }
});
const stadium = loadModule(source('landmarks-stadium'), {
  imports: { 'three/webgpu': THREE, './landmark-kit.js': kit },
  globals: { Math, console }
});
const M = kit.createLandmarkMaterials();

function buildStadium() {
  const group = new THREE.Group();
  const colliders = [];
  stadium.buildStadiumLandmarks({ group, colliders, M });
  return { group, colliders };
}

function stadiumChild(group) {
  const site = LANDMARK_SITES['Enea Stadion'];
  const child = group.children.find((c) => {
    const box = new THREE.Box3().setFromObject(c);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    return Math.hypot(cx - site.x, cz - site.z) < 10;
  });
  assert.ok(child, 'landmark group stands on the Enea Stadion site');
  return child;
}

test('Enea Stadion is a registered landmark site with the OSM lot values', () => {
  const site = LANDMARK_SITES['Enea Stadion'];
  assert.ok(site, 'LANDMARK_SITES carries the stadium');
  assert.ok(Math.abs(site.x + 5160.2) < 0.1, `x ${site.x}`);
  assert.ok(Math.abs(site.z - 1211.7) < 0.1, `z ${site.z}`);
  assert.ok(Math.abs(site.w - 250.9) < 0.1, `w ${site.w}`);
  assert.ok(Math.abs(site.d - 251.0) < 0.1, `d ${site.d}`);
  assert.equal(site.h, 56);
  assert.ok(site.ring && site.ring.length === 8, 'the OSM envelope is a four-corner ring');
  assert.ok(cityConfig.CITY_LANDMARKS.some((l) => l.id === 'stadium' && l.name === 'Enea Stadion'),
    'the map pin and location label know the stadium');
});

test('the Enea Stadion model reaches 56 m and keeps its four stands around the pitch', () => {
  const { group, colliders } = buildStadium();
  const landmark = stadiumChild(group);
  const box = new THREE.Box3().setFromObject(landmark);
  assert.ok(Math.abs(box.max.y - 56) < 0.05, `highest point ${box.max.y.toFixed(2)} m should be 56 m`);
  assert.ok(Math.abs(box.min.y) < 0.05, `model stands on the ground (min y ${box.min.y.toFixed(2)})`);
  assert.ok(box.max.x - box.min.x > 220 && box.max.z - box.min.z > 220, 'the model fills the real stadium lot');
  // The four stand colliders are the ring around the pitch; the centre (the pitch) stays open.
  const near = colliders.filter((c) => {
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    return Math.hypot(cx - LANDMARK_SITES['Enea Stadion'].x, cz - LANDMARK_SITES['Enea Stadion'].z) < 260;
  });
  assert.ok(near.length >= 8, `${near.length} colliders on the stadium`);
  assert.ok(near.every((c) => c.obb && c.obb.hx > 0 && c.obb.hz > 0), 'the turned stands emit oriented boxes');
  assert.ok(near.some((c) => Math.abs(c.maxY - 56) < 0.05), 'the corner cores reach the 56 m truss line');
  const site = LANDMARK_SITES['Enea Stadion'];
  const pitchOpen = near.every((c) => {
    const dx = site.x - c.obb.cx;
    const dz = site.z - c.obb.cz;
    const u = dx * c.obb.cs - dz * c.obb.sn;
    const w = dx * c.obb.sn + dz * c.obb.cs;
    return Math.abs(u) > c.obb.hx || Math.abs(w) > c.obb.hz;
  });
  assert.ok(pitchOpen, 'no stand collider covers the pitch centre');
});

// The real building generator, with inert three.js/TSL surfaces: only the lot layout (the part that decides whether a
// stock facility hall lands on the stadium) has to run.
function anything() {
  const fn = function () {};
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === Symbol.iterator) return undefined;
      if (key === 'then') return undefined;
      return proxy;
    },
    set: () => true,
    apply: () => proxy,
    construct: () => proxy
  });
  return proxy;
}

let cityBuild = null;
async function buildCity() {
  if (cityBuild) return cityBuild;
  const { GEO } = await import('../js/geodata.js');
  const stub = anything();
  const { buildCityBlocks } = loadModule(source('buildings'), {
    imports: {
      'three/webgpu': stub,
      'three/addons/utils/BufferGeometryUtils.js': stub,
      'three/tsl': stub,
      './balconies.js': stub,
      './tsl-materials.js': stub,
      './roofs.js': stub,
      './city-config.js': cityConfig,
      './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
    },
    globals: {
      console: { info() {}, log() {}, warn() {} }, document: stub, Math, Map, Set, WeakMap, Object, Array, Number,
      JSON, Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
    },
    filename: 'buildings.js'
  });
  cityBuild = buildCityBlocks(stub);
  return cityBuild;
}

function polygonsOverlap(a, b) {
  const axes = (p) => p.map((q, i) => {
    const r = p[(i + 1) % p.length];
    const dx = r.x - q.x;
    const dz = r.z - q.z;
    const L = Math.hypot(dx, dz) || 1;
    return { x: -dz / L, z: dx / L };
  });
  for (const n of [...axes(a), ...axes(b)]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of a) { const v = p.x * n.x + p.z * n.z; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
    for (const p of b) { const v = p.x * n.x + p.z * n.z; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}

test('generic buildings stay out of the Enea Stadion outline', async () => {
  const city = await buildCity();
  const model = new THREE.Box3().setFromObject(stadiumChild(buildStadium().group));
  const ring = [
    { x: model.min.x, z: model.min.z }, { x: model.max.x, z: model.min.z },
    { x: model.max.x, z: model.max.z }, { x: model.min.x, z: model.max.z }
  ];
  let onStadium = 0;
  let checked = 0;
  for (const blk of city.allBlocks) {
    for (const f of blk.footprints) {
      const pts = f.pts || [
        { x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }
      ];
      checked++;
      if (polygonsOverlap(pts, ring)) onStadium++;
    }
  }
  assert.ok(checked > 0, 'the building generator emitted stock footprints');
  assert.equal(onStadium, 0, `${onStadium} generated footprints overlap the stadium outline`);
  assert.ok(city.allBlocks.some((b) => b.srcBlockId === 1658), 'block 1658 is generated');
});
