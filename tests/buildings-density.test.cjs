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
  const { buildCityBlocks, shopFrontBoxes, shopFrontsOverlap } = loadModule(source, {
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
  built = { config, city: buildCityBlocks(stub), GEO, shopFrontBoxes, shopFrontsOverlap };
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

// Generated coverage of one OSM building envelope on the same 2 m raster: share of the envelope's cell centres under a
// generated footprint, plus the tallest generated part over it. Used for the park sports facilities, whose own OSM
// outline is the target (block generation includes the rest of the park and the streets).
function footprintCoverage(city, [x0, x1, z0, z1], C = 2) {
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
  const covered = new Map();
  for (const blk of city.allBlocks) {
    for (const f of blk.footprints) {
      const i0 = Math.floor(Math.max(x0, f.x0) / C);
      const i1 = Math.ceil(Math.min(x1, f.x1) / C);
      const j0 = Math.floor(Math.max(z0, f.z0) / C);
      const j1 = Math.ceil(Math.min(z1, f.z1) / C);
      if (i1 <= i0 || j1 <= j0) continue;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * C;
          const z = (j + 0.5) * C;
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          if (f.pts && !inQuad(f.pts, x, z)) continue;
          const k = j * 100000 + i;
          covered.set(k, Math.max(covered.get(k) || 0, f.h));
        }
      }
    }
  }
  let total = 0;
  for (let j = Math.floor(z0 / C); j <= Math.ceil(z1 / C); j++) {
    for (let i = Math.floor(x0 / C); i <= Math.ceil(x1 / C); i++) {
      const x = (i + 0.5) * C;
      const z = (j + 0.5) * C;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) total++;
    }
  }
  return { share: covered.size / total, hMax: Math.max(0, ...covered.values()) };
}

// Convex-polygon SAT for two 4-corner footprints (x/z); true when their interiors overlap by more than a hair.
function polygonsOverlap(a, b) {
  const axes = (p) => p.map((q, i) => {
    const r = p[(i + 1) % p.length];
    const dx = r.x - q.x, dz = r.z - q.z;
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

test('villa districts, Chartowo and the hospital campuses come out near their real built share', async () => {
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
  // The campus blocks named in the backlog: 665 Szpital Święcickiego (21% real), 576 Szpital Jonschera (37%),
  // 426/475 Ogrody/UMP (22/15%). The campus layout steers each to its block's real share instead of the
  // perimeter-only kamienica/villa share: before it 665 was 14.9% and 576 47.7%
  for (const id of [665, 576, 426, 475]) {
    const b = config.BLOCKS[id];
    assert.equal(b.program, 1, `block ${id} is a hospital campus`);
    const share = (gen.get(id) || 0) / b.area;
    assert.ok(share > b.built * 0.8 && share < b.built * 1.2,
      `campus ${id}: generated ${(100 * share).toFixed(1)}% vs real ${(100 * b.built).toFixed(1)}%`);
  }
  // Dense central university blocks keep their district profile: the campus alley grid could not spend their steep
  // share on fragmented lots and fell below the pre-change result (192 43.4 -> 22.0 %, 814 26.4 -> 19.4,
  // 769 39.1 -> 35.8). The university gate is area >= 5 ha and built <= 0.4 in blockProfile.
  for (const [id, before] of [[192, 0.434], [816, 0.264], [768, 0.391]]) {
    const b = config.BLOCKS[id];
    assert.ok(b.program > 0, `block ${id} is still tagged as a campus`);
    const share = (gen.get(id) || 0) / b.area;
    assert.ok(share >= before - 0.005,
      `gated campus ${id}: generated ${(100 * share).toFixed(1)}% vs pre-change ${(100 * before).toFixed(1)}%`);
  }
  // Hospitals use a wider gate (area >= 0.4 ha, built <= 55 %), so the real hospitals that the 5 ha campus gate
  // degraded to kamienice now take HOSPITAL: 828 (Szpital Kliniczny, 50 % built) generates 35.7 % and 991 (Strusia,
  // 25 %) 25.0 %, against 50 and 25 % real; the old district/campus mix left them at 41.8 and below.
  for (const [id, floor] of [[829, 0.35], [994, 0.24]]) {
    const b = config.BLOCKS[id];
    assert.equal(b.program, 1, `block ${id} is a hospital`);
    const share = (gen.get(id) || 0) / b.area;
    assert.ok(share >= floor, `hospital ${id}: generated ${(100 * share).toFixed(1)}% below ${(100 * floor).toFixed(1)}%`);
  }
  // Office courtyard fill (2026-11-08): the deep frontage lots and core wings move 868 from 33.4% to 48.2%, 814 from
  // 26.4% to 32.0% and 769 from 40.2% to 47.8%. Blocks already over their real share (593 36.8%, 786 44.8%) keep
  // their plazas because steerProfile leaves cfg.core off; neither may grow from the old office layout.
  for (const [id, floor] of [[870, 0.47], [816, 0.31], [768, 0.46], [817, 0.14]]) {
    const share = (gen.get(id) || 0) / config.BLOCKS[id].area;
    assert.ok(share >= floor, `office block ${id}: generated ${(100 * share).toFixed(1)}% below ${(100 * floor).toFixed(1)}%`);
  }
  for (const [id, ceiling] of [[592, 0.378], [787, 0.458]]) {
    const share = (gen.get(id) || 0) / config.BLOCKS[id].area;
    assert.ok(share <= ceiling, `over-built office ${id}: generated ${(100 * share).toFixed(1)}% above ${(100 * ceiling).toFixed(1)}%`);
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
  for (const b of parkWithoutBldgs) {
    // A mapped object on the neighbouring block can touch the shared boundary, so a handful of 2 m cells may be
    // counted on this side; the block itself still gets no generic fill.
    const spill = gen.get(b.id) || 0;
    assert.ok(spill < 500, `park block ${b.id} without mapped buildings got ${spill} m²`);
  }
  const solaczParks = parkWithBldgs.filter((b) => b.district === 'Sołacz');
  for (const b of solaczParks) assert.ok((gen.get(b.id) || 0) > 0, `Park block ${b.id} should have buildings`);
});

test('park sports facilities keep their mapped OSM footprint', async () => {
  const { config, city } = await buildCity();
  // OSM envelopes from tools/data/poz_buildings.json (way 279682863 Arena, relation 8512283 Enea Stadion, way
  // 183357024 Lodowisko Chwiałka). Before the park carve-out parkFreeCells cleared their park cells to lawn and the
  // district profile left 0 %, 0 % and 4 % of these outlines under any building.
  const targets = [
    ['Hala Arena', 927, [-2903.6, -2803.4, 1157.1, 1257.1]],
    ['Enea Stadion', 939, [-442.1, -193.1, 1231.6, 1510.5]],
    ['Lodowisko Chwiałka', 939, [-376.3, -322.3, 1759.7, 1847.1]]
  ];
  for (const [name, id, envelope] of targets) {
    const b = config.BLOCKS[id];
    assert.ok(b.park > 0 && b.parkFootprints && b.parkFootprints.length, `${name}: block ${id} carries park footprints`);
    const { share, hMax } = footprintCoverage(city, envelope);
    assert.ok(share > 0.5, `${name}: only ${(100 * share).toFixed(1)} % of its OSM envelope is built`);
    assert.ok(hMax >= 8 && hMax <= 25, `${name}: generated facility is ${hMax.toFixed(1)} m tall`);
  }
});

test('park facility halls on 925/937 do not overlap each other or a roadway', async () => {
  const { config, city } = await buildCity();
  // Arena, Enea and Chwiałka generate as one large hall per lot piece (>= 2,000 m² each); ordinary houses and
  // kamienice on Wilda's edges are below that, so this reads the facility massing directly.
  const big = city.allBlocks.filter((b) => b.srcBlockId === 927 || b.srcBlockId === 939)
    .flatMap((b) => b.footprints)
    .filter((f) => (f.x1 - f.x0) * (f.z1 - f.z0) >= 2000)
    .map((f) => ({
      h: f.h,
      pts: f.pts || [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]].map(([x, z]) => ({ x, z }))
    }));
  assert.ok(big.length >= 5, `${big.length} large facility parts generated on 925/937`);
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      assert.ok(!polygonsOverlap(big[i].pts, big[j].pts), `facility parts ${i} and ${j} overlap`);
    }
    for (const p of big[i].pts) {
      assert.ok(config.roadClearance(p.x, p.z) >= 0, `facility part ${i} reaches the roadway at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
});

test('Maraton and AWF stand opposite Karmelicka along Królowej Jadwigi', async () => {
  const { config, city } = await buildCity();
  // GEO.blockObjects[939] carries both: Biurowiec Maraton (Królowej Jadwigi 43, 112.3 x 56.3 m) and the AWF complex
  // (27/39, 111.3 x 24.4 m). The clearance check used to rotate each envelope by -ang while the build uses +ang, so a
  // mirrored corner of these 100+ m buildings reached Królowej Jadwigi and populateObject dropped the whole object,
  // leaving the quarter opposite Karmelicka empty.
  const targets = [
    // Shares of the world AABB: 0.65 and 0.41 after the envelopes are tilted into place (the footprintCoverage
    // raster counts the rotated quads, not their bounding boxes), so these gates only catch a missing object.
    ['Maraton', [-239.0, -128.8, 1022.3, 1091.9], 0.6, 8],
    ['AWF', [-113.4, 0.4, 1042.7, 1093.3], 0.35, 6]
  ];
  for (const [name, envelope, minShare, minH] of targets) {
    const { share, hMax } = footprintCoverage(city, envelope);
    assert.ok(share >= minShare, `${name}: only ${(100 * share).toFixed(1)} % of its OSM envelope is built`);
    assert.ok(hMax >= minH, `${name}: generated at ${hMax.toFixed(1)} m`);
  }
  // Nothing on block 939 may stand on Królowej Jadwigi, Karmelicka or Maratońska.
  const parts = city.allBlocks.filter((b) => b.srcBlockId === 939).flatMap((b) => b.footprints);
  assert.ok(parts.length >= 5, `${parts.length} footprints on block 939`);
  for (const f of parts) {
    const pts = f.pts || [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]].map(([x, z]) => ({ x, z }));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        assert.ok(config.roadClearance(x, z) >= -1e-6,
          `block 939 footprint reaches the roadway at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
  }
});

test('EC Garbary keeps its utility halls, chimney and cooling tower', async () => {
  const { config, city } = await buildCity();
  const block = config.BLOCKS[266];
  assert.equal(block.program, 7, 'block 266 is classified as utility');
  // The turbine/boiler halls are 15-27 m; the fallback chimney and cooling tower stand in the free yard east/west of
  // them. Before the industry snapshot the block had only generic 21 m stock and no tower at all.
  const parts = city.allBlocks.filter((b) => b.srcBlockId === 266).flatMap((b) => b.footprints);
  const halls = parts.filter((f) => (f.x1 - f.x0) * (f.z1 - f.z0) >= 1500 && f.h >= 15 && f.h <= 27);
  assert.ok(halls.length >= 2, `block 266 has ${halls.length} utility halls >= 1,500 m² at 15-27 m`);
  const towers = city.industryStructures.filter((s) => Math.hypot(s.x - 691, s.z + 902) < 250);
  assert.ok(towers.some((s) => s.kind === 'chimney' && s.height >= 55), 'EC Garbary has a chimney >= 55 m');
  assert.ok(towers.some((s) => s.kind === 'cooling' && s.height >= 45), 'EC Garbary has a cooling tower >= 45 m');
  const { GEO } = await import('../js/geodata.js');
  assert.ok(GEO.industry.some((s) => s.kind === 'chimney'), 'the OSM industry snapshot contributed a chimney');
});

test('ZNTK is an industrial block with low halls, not residential Wilda', async () => {
  const { config, city } = await buildCity();
  const block = config.BLOCKS[849];
  assert.equal(block.district, 'Wilda');
  assert.equal(block.program, 4, 'the ZNTK ruins dominate block 849 as industrial use');
  const parts = city.allBlocks.filter((b) => b.srcBlockId === 849).flatMap((b) => b.footprints);
  const halls = parts.filter((f) => (f.x1 - f.x0) * (f.z1 - f.z0) >= 1800);
  assert.ok(halls.length >= 8, `${halls.length} ZNTK hall parts >= 1,800 m²`);
  const maxH = Math.max(0, ...parts.map((f) => f.h));
  assert.ok(maxH <= 16, `ZNTK is built as 7.4-11.4 m halls, not ${maxH.toFixed(1)} m kamienice`);
});

test('Termy Maltańskie keeps its recreation hall on Malta', async () => {
  const { config, city } = await buildCity();
  const block = config.BLOCKS[612];
  assert.equal(block.program, 8, 'block 612 is classified as leisure/water park');
  // OSM way 158699450: an unnamed building=yes with addr:street=Termalna, 2633.6-2783.2 x 310.4-446.4
  const envelope = [2633.6, 2783.2, 310.4, 446.4];
  assert.ok((block.parkFootprints || []).some(([x0, x1, z0, z1, area]) =>
    Math.abs(x0 - envelope[0]) < 2 && Math.abs(x1 - envelope[1]) < 2 &&
    Math.abs(z0 - envelope[2]) < 2 && Math.abs(z1 - envelope[3]) < 2 && area > 13000),
  'the Termalna envelope survives the park carve-out');
  const { share, hMax } = footprintCoverage(city, envelope);
  assert.ok(share > 0.15, `only ${(100 * share).toFixed(1)} % of Termy is built`);
  assert.ok(hMax >= 8 && hMax <= 25, `Termy generated at ${hMax.toFixed(1)} m`);
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
  // Campus blocks replace kamienice with clinics and halls (balconies only on some university buildings), and the
  // non-residential profiles (mall, retail park, industrial hall, depot, arena) replace whole blocks of housing. The
  // west expansion adds the Marcelin/Ławica housing stock: 19,355 stacks after Etap 2 (16.5k before the non-res pass).
  assert.ok(stacks > 14000 && stacks < 21000, `Expected ~14-21k stacks, got ${stacks}`);
  assert.ok(landings > 40000 && landings < 62000, `Expected ~40-62k landings, got ${landings}`);
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

// Distance from a convex quad of {x, z} corners to a line segment: 0 when they touch, otherwise the nearest corner to
// the segment (the closest points of two disjoint convex shapes are a vertex and an edge).
function quadSegmentDistance(pts, a, b) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const inside = (p) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const c = cross(pts[i], pts[(i + 1) % pts.length], p);
      if (c > 1e-9) s |= 1;
      else if (c < -1e-9) s |= 2;
    }
    return s !== 3;
  };
  const crossing = (p, q, r, s) => {
    const d1 = cross(p, q, r), d2 = cross(p, q, s), d3 = cross(r, s, p), d4 = cross(r, s, q);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  if (inside(a) || inside(b)) return 0;
  for (let i = 0; i < pts.length; i++) {
    if (crossing(pts[i], pts[(i + 1) % pts.length], a, b)) return 0;
  }
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1e-9;
  let best = Infinity;
  for (const p of pts) {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z));
  }
  return best;
}

test('no generated building stands on Podgórna or Wrocławska', async () => {
  const { config, city, GEO } = await buildCity();
  // Linear pedestrian streets are not in the drivable graph (roadClearance cannot see them), so they are their own
  // corridors. Both streets carry the 2026-11-08 regression: fallback lots with a stale frontage frame landed on them.
  const targets = [
    ['Podgórna', config.ROADS.filter((r) => r.name === 'Podgórna')],
    ['Wrocławska', config.PEDESTRIAN_WAYS.filter((w) => w.name === 'Wrocławska')]
  ];
  const quad = (f) => f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
  for (const [name, ways] of targets) {
    assert.ok(ways.length > 0, `${name} corridor geometry exists`);
    for (const blk of city.allBlocks) {
      for (const f of blk.footprints) {
        const pts = quad(f);
        for (const way of ways) {
          for (let i = 0; i + 1 < way.pts.length; i++) {
            const d = quadSegmentDistance(pts, way.pts[i], way.pts[i + 1]) - way.w / 2;
            assert.ok(d > -1e-3,
              `${blk.id} footprint (${f.x0.toFixed(1)}, ${f.z0.toFixed(1)}) reaches the ${name} corridor (clearance ${d.toFixed(2)} m)`);
          }
        }
      }
    }
  }
  // The fallback envelopes are whole building blocks (rows, corner houses, oficyny), so they are checked as well.
  for (const [id, lots] of Object.entries(GEO.blockFallbackLots)) {
    for (const [x0, x1, z0, z1] of lots) {
      const pts = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      for (const [name, ways] of targets) {
        for (const way of ways) {
          for (let i = 0; i + 1 < way.pts.length; i++) {
            const d = quadSegmentDistance(pts, way.pts[i], way.pts[i + 1]) - way.w / 2;
            assert.ok(d >= -1e-3,
              `fallback lot ${id} (${x0.toFixed(1)}, ${z0.toFixed(1)}) reaches the ${name} corridor (clearance ${d.toFixed(2)} m)`);
          }
        }
      }
    }
  }
});

test('the Zamek Cesarski forecourt stays open towards Święty Marcin', async () => {
  const { config, city } = await buildCity();
  assert.ok(config.LANDMARK_SITES['Zamek Cesarski'], 'Zamek Cesarski is a landmark site');
  const forecourt = config.ZAMEK_FORECOURT;
  assert.ok(Array.isArray(forecourt) && forecourt.length >= 1, 'city-config reserves the castle forecourt');
  // The strip between the castle's south front (ring max z 105.7) and the north curb of ul. Święty Marcin. Block 625's
  // frontage frames used to fill it with ten 11-27 m kamienice, hiding the castle from the street.
  const zone = { x0: -1105, x1: -985, z0: 95, z1: 132 };
  const union = {
    x0: Math.min(...forecourt.map((r) => r[0])),
    x1: Math.max(...forecourt.map((r) => r[1])),
    z0: Math.min(...forecourt.map((r) => r[2])),
    z1: Math.max(...forecourt.map((r) => r[3]))
  };
  assert.ok(union.x0 <= zone.x0 && union.x1 >= zone.x1 && union.z0 <= zone.z0 && union.z1 >= zone.z1,
    'the reserved forecourt covers the view zone');
  const hits = [];
  for (const blk of city.allBlocks) {
    for (const f of blk.footprints) {
      const pts = f.pts || [
        { x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }
      ];
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      const z0 = Math.min(...pts.map((p) => p.z)), z1 = Math.max(...pts.map((p) => p.z));
      if (x1 > zone.x0 && x0 < zone.x1 && z1 > zone.z0 && z0 < zone.z1) {
        hits.push(`${blk.id} (${f.h.toFixed(1)} m at ${x0.toFixed(1)}, ${z0.toFixed(1)})`);
      }
    }
  }
  assert.deepEqual(hits, [], `generic buildings block the castle from Święty Marcin: ${hits.join('; ')}`);
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

// Distance from (x, z) to the centreline of the named streets
function roadDistance(ways, x, z) {
  let best = Infinity;
  for (const way of ways) {
    for (let i = 0; i + 1 < way.pts.length; i++) {
      const p = way.pts[i];
      const q = way.pts[i + 1];
      const vx = q.x - p.x;
      const vz = q.z - p.z;
      const t = Math.max(0, Math.min(1, ((x - p.x) * vx + (z - p.z) * vz) / (vx * vx + vz * vz)));
      best = Math.min(best, Math.hypot(x - (p.x + vx * t), z - (p.z + vz * t)));
    }
  }
  return best;
}

test('no shop awning or fascia sign overlaps another storefront, especially on Podgórna', async () => {
  const { config, city, shopFrontBoxes, shopFrontsOverlap } = await buildCity();
  const CELL = 12;
  const entries = [];
  for (const blk of city.allBlocks) {
    const ry = blk.ry || 0;
    for (const a of blk.awnings) entries.push({ blk, ry, a, ...shopFrontBoxes(a, ry) });
  }
  const extents = (b) => {
    const ex = b.hx * Math.abs(b.ax) + b.hz * Math.abs(b.bx);
    const ez = b.hx * Math.abs(b.az) + b.hz * Math.abs(b.bz);
    return [b.cx - ex, b.cx + ex, b.cz - ez, b.cz + ez];
  };
  const grid = new Map();
  const hits = [];
  for (const e of entries) {
    const [ax0, ax1, az0, az1] = extents(e.awning);
    const [sx0, sx1, sz0, sz1] = extents(e.sign);
    const x0 = Math.min(ax0, sx0), x1 = Math.max(ax1, sx1);
    const z0 = Math.min(az0, sz0), z1 = Math.max(az1, sz1);
    const cells = new Set();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) cells.add(`${i}|${j}`);
    }
    for (const key of cells) {
      for (const other of grid.get(key) || []) {
        if (shopFrontsOverlap(e.a, e.ry, other.a, other.ry)) hits.push([e, other]);
      }
    }
    for (const key of cells) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(e);
    }
  }
  const where = ([p, q]) => `${p.blk.id} (${p.a.x.toFixed(1)}, ${p.a.z.toFixed(1)}) / ` +
    `${q.blk.id} (${q.a.x.toFixed(1)}, ${q.a.z.toFixed(1)})`;
  assert.deepEqual(hits.map(where), [], 'shop fronts must not intersect each other');

  // Podgórna's narrow, diagonal frontages are where the corner case showed up: two storefronts turned into the same
  // street corner crossed each other. Pin that the street still has fronts and that none of them collide.
  const podgorna = config.ROADS.filter((r) => r.name === 'Podgórna');
  const onStreet = new Set(entries.filter((e) => roadDistance(podgorna, e.a.x, e.a.z) < 30));
  assert.ok(onStreet.size >= 20, `expected the Podgórna frontage, got ${onStreet.size} shop fronts`);
  const local = hits.filter(([p, q]) => onStreet.has(p) && onStreet.has(q));
  assert.deepEqual(local.map(where), [], 'Podgórna shop fronts must not intersect');
});

