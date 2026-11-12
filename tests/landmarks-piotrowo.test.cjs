const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');
const config = require('../js/city-config.js');
const { GEO } = require('../js/geodata.js');
const source = (name) => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
const names = ['Centrum Wykładowe PP', 'Biblioteka Techniczna PP', 'Hala Sportowa PP'];
const sites = names.map((n) => config.LANDMARK_SITES[n]);
const kit = loadModule(source('landmark-kit'), {
  imports: { 'three/webgpu': THREE, './city-config.js': config, './tsl-materials.js': {
    createPreWarBuildingMaterial: (o) => ({ ...o }), createCurtainWallMaterial: (o) => ({ ...o }),
    createFacadeBoxes: () => new THREE.Group(), createLitWindowMaterial: () => ({})
  } }
});
const builder = loadModule(source('landmarks-piotrowo'), {
  imports: { 'three/webgpu': THREE, './city-config.js': config, './landmark-kit.js': kit }
});
const M = kit.createLandmarkMaterials();
function build() {
  const group = new THREE.Group(), colliders = [];
  builder.buildPiotrowoLandmarks({ group, colliders, M });
  group.updateMatrixWorld(true);
  return { group, colliders };
}
function inside(ring, x, z) {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if ((ring[i + 1] > z) !== (ring[j + 1] > z) &&
      x < (ring[j] - ring[i]) * (z - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
  }
  return hit;
}
function contains(c, x, z, y) {
  if (y < (c.minY || 0) || y > c.maxY) return false;
  if (!c.obb) return x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;
  const { cx, cz, hx, hz, cs, sn } = c.obb;
  return Math.abs((x - cx) * cs - (z - cz) * sn) <= hx && Math.abs((x - cx) * sn + (z - cz) * cs) <= hz;
}

test('Piotrowo models use the three OSM footprints and levels without adding map pins or teleports', () => {
  const { group } = build();
  assert.deepEqual(group.children.map((c) => c.name), names);
  assert.deepEqual(sites.map((s) => s.h), [6.8, 10.2, 10.2]);
  assert.deepEqual(sites.map((s) => s.holes.length), [1, 3, 0]);
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i], bounds = new THREE.Box3().setFromObject(group.children[i]);
    assert.ok(Math.abs(bounds.max.y - s.h) < 0.01, `${names[i]} has its OSM-derived top`);
    assert.ok(Math.abs(bounds.min.y - 0.24) < 1e-5, 'stands on the sidewalk');
    assert.equal(s.map, false);
    assert.ok(!config.CITY_LANDMARKS.some((p) => p.x === s.x && p.z === s.z));
  }
  assert.ok(!Object.hasOwn(config.TELEPORT_LOCATIONS, 'politechnika'));
  const materials = new Set(Object.values(M).filter((m) => m && !m.facade));
  Object.values(M.facade).forEach((m) => materials.add(m));
  group.traverse((m) => { if (m.isMesh) assert.ok(materials.has(m.material), 'reuses shared materials'); });
});

test('Piotrowo player and vehicle colliders cover the solid buildings and leave the patios open', () => {
  const { colliders } = build();
  assert.ok(!colliders.some((c) => contains(c, 1037.6, 480.1, 1)), 'ground body can pass under west overhang');
  assert.ok(colliders.some((c) => contains(c, 1037.6, 480.1, 4)), 'upper overhang blocks elevated bodies');
  for (const s of sites) {
    let solid = 0;
    const xs = s.ring.filter((_, i) => i % 2 === 0), zs = s.ring.filter((_, i) => i % 2 === 1);
    for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) {
      for (let z = Math.min(...zs) + 1; z < Math.max(...zs); z += 2) {
        if (!inside(s.ring, x, z)) continue;
        const patio = s.holes.some((h) => inside(h, x, z));
        if (!patio) {
          solid++;
          assert.ok(colliders.some((c) => contains(c, x, z, 4)), `solid at ${x},${z}`);
          assert.ok(config.isLand(x, z), 'no water beneath solid geometry');
          assert.ok(config.roadClearance(x, z) > 0, 'no carriageway beneath solid geometry');
        }
      }
    }
    assert.ok(solid > 500, 'tested actual footprint area');
    for (const h of s.holes) {
      const n = h.length / 2;
      const x = h.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b) / n;
      const z = h.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b) / n;
      assert.ok(!colliders.some((c) => contains(c, x, z, 1)), 'open courtyard has no invisible collider');
    }
  }
});

function inert() {
  let p;
  p = new Proxy(function () {}, {
    get: (_t, k) => k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? undefined : k === 'then' ? undefined : p,
    set: () => true, apply: () => p, construct: () => p
  });
  return p;
}
function buildBlocks(before) {
  const stub = inert();
  const src = before ? source('buildings').replace(
    ", 'Centrum Wykładowe PP', 'Biblioteka Techniczna PP', 'Hala Sportowa PP'", '') : source('buildings');
  return loadModule(src, {
    imports: {
      'three/webgpu': stub, 'three/tsl': stub, 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './roofs.js': stub, './balconies.js': stub,
      './city-config.js': config, './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [], railClearance: () => Infinity }
    }, globals: { document: stub, console: { info() {}, log() {}, warn() {} } }
  }).buildCityBlocks(stub);
}

test('Piotrowo reserves clear mapped footprints while preserving buildings beyond 300 m', () => {
  const before = buildBlocks(true), after = buildBlocks(false);
  const footprints = (city) => city.allBlocks.flatMap((b) => b.footprints);
  const distance = (f) => Math.hypot((f.x0 + f.x1) / 2 - 1040, (f.z0 + f.z1) / 2 - 580);
  const hash = (a) => createHash('sha256').update(JSON.stringify(a)).digest('hex');
  assert.equal(hash(footprints(before).filter((f) => distance(f) > 300)),
    hash(footprints(after).filter((f) => distance(f) > 300)), 'outside footprint geometry and tones are identical');
  assert.ok(footprints(after).filter((f) => distance(f) < 300).length > 100, 'surrounding campus stays populated');
  const containsFootprint = (f, x, z) => f.pts ? inside(f.pts.flatMap((p) => [p.x, p.z]), x, z) :
    x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
  const beforeNear = footprints(before).filter((f) => distance(f) < 300);
  const afterNear = footprints(after).filter((f) => distance(f) < 300);
  let beforeHits = 0;
  for (const s of sites) for (let x = s.x - 70; x < s.x + 70; x += 2) for (let z = s.z - 70; z < s.z + 70; z += 2) {
    if (!inside(s.ring, x, z)) continue;
    beforeHits += beforeNear.some((f) => containsFootprint(f, x, z));
    assert.ok(!afterNear.some((f) => containsFootprint(f, x, z)),
      `no generic building under ${x},${z}`);
  }
  assert.ok(beforeHits > 0, 'positive control detects the displaced generated buildings');
});

test('Piotrowo geometry stays off roads, tram tracks and water, and roofs retain courtyard holes', () => {
  const { group } = build();
  const segments = [];
  for (const rail of GEO.rail) {
    for (let i = 2; i < rail.pts.length; i += 2) {
      const a = [rail.pts[i - 2], rail.pts[i - 1]], b = [rail.pts[i], rail.pts[i + 1]];
      if (Math.max(a[0], b[0]) < 850 || Math.min(a[0], b[0]) > 1150 ||
        Math.max(a[1], b[1]) < 400 || Math.min(a[1], b[1]) > 800) continue;
      segments.push([a, b]);
    }
  }
  let vertices = 0;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (const local of mesh.geometry.vertices) {
      const p = local.clone().applyMatrix4(mesh.matrixWorld);
      vertices++;
      assert.ok(config.isLand(p.x, p.z), 'geometry on land');
      assert.ok(config.roadClearance(p.x, p.z) > 0, `vertex clear of carriageway: ${p.x},${p.z}`);
      for (const [a, b] of segments) {
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (dx * dx + dz * dz)));
        assert.ok(Math.hypot(p.x - a[0] - dx * t, p.z - a[1] - dz * t) > 2.3, 'vertex clear of tram envelope');
      }
    }
  });
  assert.ok(vertices > 1000);
  for (let i = 0; i < sites.length; i++) {
    const slabs = group.children[i].children.filter((m) => m.geometry?.type === 'ExtrudeGeometry');
    assert.ok(slabs.length >= 2, 'walls and a solid roof');
    for (const mesh of slabs) assert.equal(mesh.geometry.parameters.shape.holes.length, sites[i].holes.length);
  }
});
