const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/buildings.js'), 'utf8');

// Stand-in for three.js, TSL, the materials, roofs and balconies: every property, call and `new` gives another
// stand-in, so the scene half of buildCityBlocks runs through while the lot layout (the part under test) is real
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

let built = null;
async function buildCity() {
  if (built) return built;
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const stub = anything();
  const { buildCityBlocks } = loadModule(source, {
    imports: {
      'three/webgpu': stub,
      'three/addons/utils/BufferGeometryUtils.js': stub,
      'three/tsl': stub,
      './balconies.js': stub,
      './tsl-materials.js': stub,
      './roofs.js': stub,
      './city-config.js': config,
      './geodata.js': { GEO },
      './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
    },
    globals: {
      console: { info() {}, log() {}, warn() {} }, document: stub, Math, Map, Set, WeakMap, Object, Array, Number, JSON,
      Infinity, NaN, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array
    },
    filename: 'buildings.js'
  });
  built = { config, city: buildCityBlocks(stub) };
  return built;
}

// Footprints on a 2 m raster, each cell counted once for the block under it; returns block id -> built m²
function generatedByBlock(config, city) {
  const B = config.CITY_BOUNDS;
  const C = 2;
  const RW = Math.ceil((B.maxX - B.minX) / C);
  const RH = Math.ceil((B.maxZ - B.minZ) / C);
  const cells = new Uint8Array(RW * RH);
  const inQuad = (pts, x, z) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
      if (c > 0) s |= 1;
      else if (c < 0) s |= 2;
    }
    return s !== 3;
  };
  for (const blk of city.allBlocks) {
    for (const f of blk.footprints) {
      const i0 = Math.max(0, Math.floor((f.x0 - B.minX) / C));
      const i1 = Math.min(RW - 1, Math.floor((f.x1 - B.minX) / C));
      const j0 = Math.max(0, Math.floor((f.z0 - B.minZ) / C));
      const j1 = Math.min(RH - 1, Math.floor((f.z1 - B.minZ) / C));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = B.minX + (i + 0.5) * C;
          const z = B.minZ + (j + 0.5) * C;
          if (!f.pts || inQuad(f.pts, x, z)) cells[j * RW + i] = 1;
        }
      }
    }
  }
  const gen = new Map();
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      if (!cells[j * RW + i]) continue;
      const b = config.blockAt(B.minX + (i + 0.5) * C, B.minZ + (j + 0.5) * C);
      if (b) gen.set(b.id, (gen.get(b.id) || 0) + C * C);
    }
  }
  return gen;
}

// Generated vs real (GEO.blockStats) built share of the land of the district's blocks that buildings.js builds on
// (park blocks with mapped buildings in OSM are built; purely unmapped park blocks stay unbuilt)
function districtShares(config, gen, district) {
  let land = 0, real = 0, ours = 0;
  for (const b of config.BLOCKS) {
    if (b.district !== district || (b.park > 0.6 && !b.buildings) || b.median) continue;
    land += b.area;
    real += b.built * b.area;
    ours += gen.get(b.id) || 0;
  }
  return { real: real / land, gen: ours / land };
}

test('villa districts and Chartowo come out near their real built share', async () => {
  const { config, city } = await buildCity();
  const gen = generatedByBlock(config, city);
  // Measured (generated / real, buildable blocks): Sołacz 12.7 / 12.9 %, Winiary 17.4 / 17.0, Ogrody 17.1 / 15.9,
  // Grunwald Południe 9.4 / 10.3, Warszawskie-Pomet-Maltańskie 16.2 / 15.1, Chartowo 13.0 / 12.1. Before the villa
  // layout: Sołacz 7.1, Winiary 8.8, Ogrody 10.2, Grunwald Południe 6.9, Warszawskie 10.6, Chartowo 18.7
  const districts = ['Sołacz', 'Winiary', 'Ogrody', 'Grunwald Południe', 'Warszawskie-Pomet-Maltańskie', 'Chartowo'];
  for (const district of districts) {
    const s = districtShares(config, gen, district);
    assert.ok(s.gen > s.real * 0.8 && s.gen < s.real * 1.2,
      `${district}: generated ${(100 * s.gen).toFixed(1)}% vs real ${(100 * s.real).toFixed(1)}%`);
  }
});

test('a block with no mapped building stays empty', async () => {
  const { config, city } = await buildCity();
  const gen = generatedByBlock(config, city);
  const naramowice = config.BLOCKS.filter((b) => b.district === 'Naramowice' && !b.buildings && b.area > 100000);
  assert.ok(naramowice.length >= 1);
  for (const b of naramowice) assert.equal(gen.get(b.id) || 0, 0);
});

test('park blocks with mapped buildings are built while unmapped park blocks stay empty', async () => {
  const { config, city } = await buildCity();
  const gen = generatedByBlock(config, city);
  const parkWithBldgs = config.BLOCKS.filter((b) => b.park > 0.6 && !b.median && b.buildings > 0);
  const parkWithoutBldgs = config.BLOCKS.filter((b) => b.park > 0.6 && !b.median && !b.buildings);
  assert.ok(parkWithBldgs.length > 0);
  assert.ok(parkWithoutBldgs.length > 0);
  for (const b of parkWithoutBldgs) assert.equal(gen.get(b.id) || 0, 0);
  const solaczParks = parkWithBldgs.filter((b) => b.district === 'Sołacz');
  for (const b of solaczParks) assert.ok((gen.get(b.id) || 0) > 0, `Park block ${b.id} should have buildings`);
});

test('villa blocks are detached houses with gardens between them', async () => {
  const { city } = await buildCity();
  const villas = city.allBlocks.filter((b) => b.district === 'Sołacz');
  let houses = 0, touching = 0;
  for (const blk of villas) {
    // ground-floor parts, one per house or annex (a house and its annex share a tone), in the lot's own frame: the
    // world corners of a turned lot's parts turned back by its yaw
    const cs = Math.cos(blk.ry || 0);
    const sn = Math.sin(blk.ry || 0);
    const parts = blk.footprints.filter((f) => f.h <= 12).map((f) => {
      if (!f.pts) return f;
      const u = f.pts.map((p) => p.x * cs - p.z * sn);
      const v = f.pts.map((p) => p.x * sn + p.z * cs);
      return { tone: f.tone, x0: Math.min(...u), x1: Math.max(...u), z0: Math.min(...v), z1: Math.max(...v) };
    });
    const tones = new Map();
    for (const f of parts) (tones.get(f.tone) || tones.set(f.tone, []).get(f.tone)).push(f);
    const list = [...tones.values()];
    houses += list.length;
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) {
        const near = list[i].some((a) => list[k].some((c) =>
          Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > -2 && Math.min(a.z1, c.z1) - Math.max(a.z0, c.z0) > -2));
        if (near) touching++;
      }
    }
  }
  assert.ok(houses > 800, `${houses} houses in Sołacz`);
  // free-standing: under 2% of the houses stand within 2 m of another
  assert.ok(touching < houses * 0.02, `${touching} of ${houses} houses within 2 m of another`);
});

test('the same seed builds the same city', async () => {
  const { city } = await buildCity();
  const sum = (c) => c.allBlocks.reduce((t, b) => t + b.footprints.reduce((s, f) => s + f.x0 * 3 + f.z1 * 7 + f.h, 0), 0);
  const first = sum(city);
  built = null;
  const again = await buildCity();
  assert.equal(sum(again.city), first);
});

// Balcony pool capacities from js/balconies.js and js/buildings.js
const MAX_STACKS = 2400;
const MAX_NEAR_BALCONIES = 256;
const NEAR_DISTANCE = 90;
const STREAM_RADIUS = 560;

function evaluateBalconiesAt(city, focusX, focusZ) {
  const nearby = city.quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
  nearby.sort((a, b) => {
    const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
    const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
    return da - db;
  });

  let total = 0;
  let nearCount = 0;
  let farCount = 0;
  let nearDemand = 0;
  let totalStacksInRange = 0;

  for (const blk of nearby) {
    if (!blk.balconies) continue;
    for (const b of blk.balconies) {
      totalStacksInRange++;
      if (total >= MAX_STACKS) continue;
      total++;
      const dx = b.x - focusX, dz = b.z - focusZ;
      if (dx * dx + dz * dz < NEAR_DISTANCE * NEAR_DISTANCE) {
        nearDemand += b.landings;
        if (nearCount + b.landings <= MAX_NEAR_BALCONIES) {
          nearCount += b.landings;
        } else {
          farCount++;
        }
      } else {
        farCount++;
      }
    }
  }
  return {
    total,
    totalStacksInRange,
    nearCount,
    farCount,
    nearDemand,
    dropped: totalStacksInRange - total
  };
}

test('balcony stacks city-wide count and distribution', async () => {
  const { city } = await buildCity();
  let stacks = 0, landings = 0;
  for (const b of city.allBlocks) {
    if (!b.balconies) continue;
    stacks += b.balconies.length;
    for (const bal of b.balconies) landings += bal.landings;
  }
  assert.ok(stacks > 15000 && stacks < 18000, `Expected ~16.5k stacks, got ${stacks}`);
  assert.ok(landings > 45000 && landings < 52000, `Expected ~48k landings, got ${landings}`);
});

test('streamed balcony stacks never exceed MAX_STACKS (2400) and keep comfortable margin', async () => {
  const { config, city } = await buildCity();
  const hotspots = [
    { name: 'Jeżyce peak', x: -1819.1, z: -478.4 },
    { name: 'Łazarz peak', x: -2450.7, z: 1525.0 },
    { name: 'Stare Miasto peak', x: -172.6, z: 185.4 },
    { name: 'Wilda peak', x: -1080.7, z: 2144.5 },
    { name: 'Rataje peak', x: 1294.7, z: 1352.0 },
    { name: 'Stary Rynek', x: config.TELEPORT_LOCATIONS.rynek.x, z: config.TELEPORT_LOCATIONS.rynek.z },
    { name: 'Spawn', x: config.SPAWN.x, z: config.SPAWN.z }
  ];

  let maxStacks = 0;
  for (const pt of hotspots) {
    const res = evaluateBalconiesAt(city, pt.x, pt.z);
    assert.equal(res.dropped, 0, `No balcony stacks should be dropped at ${pt.name}`);
    assert.ok(res.total <= MAX_STACKS, `Total stacks ${res.total} exceeded cap ${MAX_STACKS} at ${pt.name}`);
    if (res.total > maxStacks) maxStacks = res.total;
  }

  // Subsample block centres across the entire city
  for (let i = 0; i < city.allBlocks.length; i += 4) {
    const b = city.allBlocks[i];
    const res = evaluateBalconiesAt(city, b.cx, b.cz);
    assert.equal(res.dropped, 0, `Stacks dropped at block ${b.id}`);
    assert.ok(res.total <= MAX_STACKS, `Stacks ${res.total} exceeded cap at block ${b.id}`);
    if (res.total > maxStacks) maxStacks = res.total;
  }

  // Peak stacks is ~1300, guaranteeing at least a 1000-stack (~40%) margin below 2400
  assert.ok(maxStacks <= 1400, `Peak stacks ${maxStacks} higher than expected`);
  assert.ok(MAX_STACKS - maxStacks >= 1000, `Safety margin under 1000 stacks: ${MAX_STACKS - maxStacks}`);
});

test('near balcony landings respect MAX_NEAR_BALCONIES (256) buffer with graceful far LOD fallback', async () => {
  const { config, city } = await buildCity();
  const testPoints = [
    { name: 'Wilda dense junction', x: -681.4, z: 1811.2 },
    { name: 'Łazarz dense junction', x: -2600.7, z: 2325.0 },
    { name: 'Rataje dense junction', x: 1794.7, z: 1977.0 },
    { name: 'Jeżyce hotspot', x: -1994.1, z: -728.4 },
    { name: 'Stare Miasto hotspot', x: 427.4, z: -414.6 },
    { name: 'Stary Rynek', x: config.TELEPORT_LOCATIONS.rynek.x, z: config.TELEPORT_LOCATIONS.rynek.z }
  ];

  for (const pt of testPoints) {
    const res = evaluateBalconiesAt(city, pt.x, pt.z);
    // Hard invariant: instanced buffer never overflows
    assert.ok(res.nearCount <= MAX_NEAR_BALCONIES, `nearCount ${res.nearCount} exceeded ${MAX_NEAR_BALCONIES} at ${pt.name}`);
    // Graceful degradation: points with demand > 256 saturate near pool and push excess to far proxies
    if (res.nearDemand > MAX_NEAR_BALCONIES) {
      assert.ok(res.farCount > 0, `Overflowing balconies should degrade to far proxies at ${pt.name}`);
      assert.ok(res.nearCount >= 240, `High demand point should saturate near pool: ${res.nearCount}`);
    }
  }
});
