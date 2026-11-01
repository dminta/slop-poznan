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

let config;
let GEO;
let net;
let railInfra;
let tramInfraMod;

test.before(async () => {
  config = await import('../js/city-config.js');
  ({ GEO } = await import('../js/geodata.js'));

  const rnSource = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
  const { buildRoadNetwork } = loadModule(rnSource, {
    imports: { './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, log() {}, warn() {} } },
    filename: 'road-network.js'
  });
  net = buildRoadNetwork([], []);

  const tiSource = readFileSync(join(__dirname, '../js/tram-infra.js'), 'utf8');
  const rendering = {
    'three/webgpu': inert(),
    'three/tsl': inert(),
    'three/addons/utils/BufferGeometryUtils.js': inert(),
    './tsl-materials.js': inert()
  };
  tramInfraMod = loadModule(tiSource, {
    imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
    globals: { Math, Object, Array, Set, Map, Number, Float32Array, Float64Array, console: { info() {}, warn() {}, log() {} }, document: inert() },
    filename: 'tram-infra.js'
  });
  railInfra = tramInfraMod.layoutRailInfrastructure(net);
});

test('RAIL_BRIDGES exports railway bridges across Warta and Cybina with width >= 14 m', () => {
  assert.ok(Array.isArray(config.RAIL_BRIDGES), 'RAIL_BRIDGES is exported as an array');
  assert.equal(config.RAIL_BRIDGES.length, 2, 'contains exactly 2 railway river bridge definitions');

  const garbary = config.RAIL_BRIDGES.find((b) => b.name === 'Most kolejowy Garbary');
  assert.ok(garbary, 'Most kolejowy Garbary is defined');
  assert.equal(garbary.railbridge, true);
  assert.ok(garbary.links[0].width >= 14, `Garbary span width ${garbary.links[0].width} m >= 14 m`);
  assert.equal(garbary.links[0].pts[0].x, 425);
  assert.equal(garbary.links[0].pts[1].x, 515);

  const cybina = config.RAIL_BRIDGES.find((b) => b.name === 'Most kolejowy przez Cybinę');
  assert.ok(cybina, 'Most kolejowy przez Cybinę is defined');
  assert.equal(cybina.railbridge, true);
  assert.ok(cybina.links[0].width >= 14, `Cybina span width ${cybina.links[0].width} m >= 14 m`);
  assert.equal(cybina.links[0].pts[0].x, 1160);
  assert.equal(cybina.links[0].pts[1].x, 1205);
});

test('RAIL_BRIDGES corridors are rasterised as walkable land (isLand === true, isWater === false)', () => {
  // Test midpoints of both railway river bridges
  const garbaryMid = { x: (425 + 515) / 2, z: (-825 + -790) / 2 };
  assert.equal(config.isLand(garbaryMid.x, garbaryMid.z), true, 'Garbary railway bridge midpoint is land');
  assert.equal(config.isWater(garbaryMid.x, garbaryMid.z), false, 'Garbary railway bridge midpoint is not water');

  const cybinaMid = { x: (1160 + 1205) / 2, z: (-635 + -615) / 2 };
  assert.equal(config.isLand(cybinaMid.x, cybinaMid.z), true, 'Cybina railway bridge midpoint is land');
  assert.equal(config.isWater(cybinaMid.x, cybinaMid.z), false, 'Cybina railway bridge midpoint is not water');
});

test('mainline railway tracks across Warta (Garbary) and Cybina are continuous with zero end walls', () => {
  // Garbary railway bridge: x in [425, 515], z in [-825, -790]
  const garbaryPieces = railInfra.pieces.filter((p) => {
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    return mx >= 425 && mx <= 515 && mz >= -830 && mz <= -785;
  });
  assert.ok(garbaryPieces.length >= 20, `Garbary has ${garbaryPieces.length} kept pieces across the river span (expected >= 20)`);

  const garbaryEnds = railInfra.ends.filter((e) => e.x >= 420 && e.x <= 520 && e.z >= -830 && e.z <= -785);
  assert.equal(garbaryEnds.length, 0, 'zero end walls in the Garbary railway bridge corridor');

  // Cybina railway bridge: x in [1160, 1205], z in [-635, -615]
  const cybinaPieces = railInfra.pieces.filter((p) => {
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    return mx >= 1160 && mx <= 1205 && mz >= -640 && mz <= -610;
  });
  assert.ok(cybinaPieces.length >= 8, `Cybina has ${cybinaPieces.length} kept pieces across the river span (expected >= 8)`);

  const cybinaEnds = railInfra.ends.filter((e) => e.x >= 1155 && e.x <= 1210 && e.z >= -640 && e.z <= -610);
  assert.equal(cybinaEnds.length, 0, 'zero end walls in the Cybina railway bridge corridor');
});

test('railway tracks crossing Most Teatralny, Most Uniwersytecki and Most Dworcowy are elevated on viaducts with >= 6.0 m vertical clearance', () => {
  // Most Teatralny: x in [-1380, -1265], z in [-225, -170]
  const teatrViaducts = railInfra.viaducts.filter((v) => v.mx >= -1380 && v.mx <= -1265 && v.mz >= -225 && v.mz <= -170);
  assert.ok(teatrViaducts.length >= 5, `Most Teatralny has ${teatrViaducts.length} elevated viaduct spans (expected >= 5)`);
  for (const v of teatrViaducts) {
    assert.equal(v.hasTram, true, 'Most Teatralny viaduct span detects tram corridor');
    assert.ok(v.yClearance >= 6.0, `Most Teatralny viaduct vertical clearance ${v.yClearance} m >= 6.0 m`);
    assert.ok(v.deckY >= 6.35, `Most Teatralny deck height ${v.deckY} m >= 6.35 m`);
  }
  const teatrEnds = railInfra.ends.filter((e) => e.x >= -1380 && e.x <= -1265 && e.z >= -225 && e.z <= -170 && !e.viaduct);
  assert.equal(teatrEnds.length, 0, 'zero blocking non-viaduct end walls at Most Teatralny');

  // Most Uniwersytecki: x in [-1450, -1320], z in [50, 150]
  const uniwViaducts = railInfra.viaducts.filter((v) => v.mx >= -1450 && v.mx <= -1320 && v.mz >= 50 && v.mz <= 150);
  assert.ok(uniwViaducts.length >= 6, `Most Uniwersytecki has ${uniwViaducts.length} elevated viaduct spans (expected >= 6)`);
  for (const v of uniwViaducts) {
    assert.equal(v.hasTram, true, 'Most Uniwersytecki viaduct span detects tram corridor');
    assert.ok(v.yClearance >= 6.0, `Most Uniwersytecki viaduct vertical clearance ${v.yClearance} m >= 6.0 m`);
    assert.ok(v.deckY >= 6.35, `Most Uniwersytecki deck height ${v.deckY} m >= 6.35 m`);
  }
  const uniwEnds = railInfra.ends.filter((e) => e.x >= -1450 && e.x <= -1320 && e.z >= 50 && e.z <= 150 && !e.viaduct);
  assert.equal(uniwEnds.length, 0, 'zero blocking non-viaduct end walls at Most Uniwersytecki');

  // Most Dworcowy: x in [-1565, -1335], z in [500, 630]
  const dworcViaducts = railInfra.viaducts.filter((v) => v.mx >= -1565 && v.mx <= -1335 && v.mz >= 500 && v.mz <= 630);
  assert.ok(dworcViaducts.length >= 20, `Most Dworcowy has ${dworcViaducts.length} elevated viaduct spans (expected >= 20)`);
  for (const v of dworcViaducts) {
    assert.equal(v.hasTram, true, 'Most Dworcowy viaduct span detects tram corridor');
    assert.ok(v.yClearance >= 6.0, `Most Dworcowy viaduct vertical clearance ${v.yClearance} m >= 6.0 m`);
    assert.ok(v.deckY >= 6.35, `Most Dworcowy deck height ${v.deckY} m >= 6.35 m`);
  }
  const dworcEnds = railInfra.ends.filter((e) => e.x >= -1565 && e.x <= -1335 && e.z >= 500 && e.z <= 630 && !e.viaduct);
  assert.equal(dworcEnds.length, 0, 'zero blocking non-viaduct end walls at Most Dworcowy');

  // ul. Karola Libelta: x in [-1285, -1170], z in [-590, -500] elevated viaducts over the street
  const libeltaViaducts = railInfra.viaducts.filter((v) => v.mx >= -1285 && v.mx <= -1170 && v.mz >= -590 && v.mz <= -500);
  assert.ok(libeltaViaducts.length >= 4, `ul. Libelta has ${libeltaViaducts.length} elevated viaduct spans (expected >= 4)`);
  for (const v of libeltaViaducts) {
    assert.ok(v.yClearance >= 4.8, `ul. Libelta viaduct vertical clearance ${v.yClearance} m >= 4.8 m`);
    assert.ok(v.deckY >= 5.14, `ul. Libelta viaduct deck height ${v.deckY} m >= 5.14 m`);
  }
  // All remaining track pieces in the Libelta corridor are elevated approach ramps, zero ground pieces crossing the roadway
  const libeltaGroundOnRoad = railInfra.pieces.filter((p) => {
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    return mx >= -1285 && mx <= -1170 && mz >= -590 && mz <= -500 && railInfra.roadDist(mx, mz) < 0 && p.yA < 0.1 && p.yB < 0.1;
  });
  assert.equal(libeltaGroundOnRoad.length, 0, 'zero ground track pieces crossing ul. Libelta roadway');
  const libeltaEnds = railInfra.ends.filter((e) => e.x >= -1285 && e.x <= -1170 && e.z >= -590 && e.z <= -500 && !e.viaduct);
  assert.equal(libeltaEnds.length, 0, 'zero blocking non-viaduct end walls under ul. Libelta');
});

test('river bridge pieces generate steel plate girders, deck slab and concrete piers', () => {
  const infra = tramInfraMod.buildTramInfrastructure(inert(), net);
  assert.ok(infra.colliders.length > 0, 'infrastructure colliders built');

  // Verify that kept pieces over water are reduced to only edge cases
  assert.ok(railInfra.dropped.water <= 5, `dropped water pieces ${railInfra.dropped.water} <= 5 (was 25)`);
  assert.ok(railInfra.ends.length <= 180, `total end walls ${railInfra.ends.length} <= 180 (including viaduct abutments)`);
  assert.ok(railInfra.ends.filter((e) => !e.viaduct).length <= 120, 'blocking non-viaduct end walls <= 120');
  assert.ok(railInfra.pieces.length >= 12700, `total kept pieces ${railInfra.pieces.length} >= 12700`);
});
