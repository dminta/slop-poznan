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
      // The real track distance (city-grid.js railClearance), so courtyards are filtered as in the browser build.
      './city-grid.js': {
        pavedPlazaRects: [], parkTreeSites: [], railClearance: railDistanceIndex(GEO), sidewalkBlocks: []
      }
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

// Footprint test in world x/z: turned footprints carry pts, world-axis lots their AABB.
function footprintHolds(f, x, z) {
  if (!f.pts) return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = f.pts[i], b = f.pts[(i + 1) % 4];
    const c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (c > 0) s |= 1;
    else if (c < 0) s |= 2;
  }
  return s !== 3;
}

// Distance from (x, z) to a block's curb outline (the poly of {x, z} points).
function distanceToOutline(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const vx = b.x - a.x, vz = b.z - a.z;
    const len2 = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
  }
  return best;
}

// Perimeter samples every ~2 m plus a 3x3 inner grid: the same probes yardFitsBlock uses in production.
function yardProbes(y) {
  const cs = Math.cos(y.ry || 0), sn = Math.sin(y.ry || 0);
  const cx = (y.x0 + y.x1) * 0.5, cz = (y.z0 + y.z1) * 0.5;
  const hx = (y.x1 - y.x0) * 0.5, hz = (y.z1 - y.z0) * 0.5;
  const at = (u, v) => ({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
  const out = [];
  const nu = Math.max(1, Math.ceil((2 * hx) / 2));
  const nv = Math.max(1, Math.ceil((2 * hz) / 2));
  for (let i = 0; i <= nu; i++) {
    const u = -hx + (2 * hx * i) / nu;
    out.push(at(u, -hz), at(u, hz));
  }
  for (let j = 0; j <= nv; j++) {
    const v = -hz + (2 * hz * j) / nv;
    out.push(at(-hx, v), at(hx, v));
  }
  for (const fu of [-0.5, 0, 0.5]) for (const fv of [-0.5, 0, 0.5]) out.push(at(hx * fu, hz * fv));
  return out;
}

// Distance to the nearest GEO.rail centreline (tram or mainline), from a 64 m bucket index. GEO.rail pts are flat
// [x0, z0, x1, z1, ...] arrays (js/geodata.js header).
function railDistanceIndex(GEO) {
  const CELL = 64;
  const grid = new Map();
  for (const chain of GEO.rail || []) {
    const pts = chain.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const a = { x: pts[i], z: pts[i + 1] }, b = { x: pts[i + 2], z: pts[i + 3] };
      const seg = [a.x, a.z, b.x, b.z];
      for (let ix = Math.floor(Math.min(a.x, b.x) / CELL); ix <= Math.floor(Math.max(a.x, b.x) / CELL); ix++) {
        for (let iz = Math.floor(Math.min(a.z, b.z) / CELL); iz <= Math.floor(Math.max(a.z, b.z) / CELL); iz++) {
          const k = ix * 100000 + iz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  return (x, z) => {
    let best = Infinity;
    for (let ix = Math.floor((x - 8) / CELL); ix <= Math.floor((x + 8) / CELL); ix++) {
      for (let iz = Math.floor((z - 8) / CELL); iz <= Math.floor((z + 8) / CELL); iz++) {
        for (const [ax, az, bx, bz] of grid.get(ix * 100000 + iz) || []) {
          const dx = bx - ax, dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
          best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
        }
      }
    }
    return best;
  };
}

const wrapQuarter = (a) => ((((a + Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) - Math.PI / 4;

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Footprint corners plus edge midpoints: the probes used for clearance checks.
function probePoints(f) {
  const pts = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
  const out = pts.slice();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  }
  return out;
}

// Share of stations along a road that have a generated footprint in a band on one side. side +1 is west/left of the
// south-to-north centreline, -1 east/right; the band starts past the 5.25 m carriageway and its sidewalk and reaches
// into the building depth. z0/z1 restrict the stretch under test.
function frontageCoverage(footprints, road, side, z0 = -Infinity, z1 = Infinity, d0 = 10, d1 = 30) {
  const pts = road.pts;
  let total = 0, built = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len));
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (z < z0 || z > z1) continue;
      total++;
      for (let d = d0; d <= d1; d += 2) {
        if (footprints.some((f) => footprintHolds(f, x - dz * side * d, z + dx * side * d))) { built++; break; }
      }
    }
  }
  return built / total;
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
  // Measured (generated / real, buildable blocks): Sołacz 6.2 / 6.4 %, Winiary 17.8 / 17.0, Ogrody 16.2 / 16.0,
  // Grunwald Południe 18.3 / 16.7, Warszawskie-Pomet-Maltańskie 13.8 / 11.2, Chartowo 14.0 / 12.5. The 1.25 ceiling
  // (it was 1.2) leaves room for the restored mapped objects and fallback frontages: block objects are now reserved
  // with their own oriented bounds instead of their first four tuple values, and frontage fallbacks are checked after
  // the runtime shrink (2026-11-09), so Warszawskie gained 0.4 pp against a tight 13.4 % ceiling.
  const districts = ['Sołacz', 'Winiary', 'Ogrody', 'Grunwald Południe', 'Warszawskie-Pomet-Maltańskie', 'Chartowo'];
  for (const district of districts) {
    const s = districtShares(config, gen, district);
    assert.ok(s.gen > s.real * 0.8 && s.gen < s.real * 1.25,
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
  // 25 %) 25.0 %, against 50 and 25 % real; the old district/campus mix left them at 41.8 and below. Since the
  // 2026-11-10 legacy gate 829 is in Stare Miasto and builds kamienice as at 4d14df9 (the user's decision); the floor
  // still holds and guards its share.
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
  // 592 (42.4 %) and 787 keep their plazas after the 2026-11-09 object/fallback fix restores their mapped buildings;
  // their ceilings follow the restored footprints instead of the pre-fix 37.8 %.
  for (const [id, ceiling] of [[592, 0.43], [787, 0.458]]) {
    const share = (gen.get(id) || 0) / config.BLOCKS[id].area;
    assert.ok(share <= ceiling, `over-built office ${id}: generated ${(100 * share).toFixed(1)}% above ${(100 * ceiling).toFixed(1)}%`);
  }
});

test('Gwarna keeps a dense frontage on both sides and no building reaches its roadway', async () => {
  const { config, city } = await buildCity();
  const road = config.ROADS.find((r) => r.name === 'Gwarna');
  assert.ok(road, 'Gwarna is in the road list');
  // Block 648's mapped education object is an oriented 78.8 × 44.8 m rect. Reading its first four values as a world
  // AABB made the reserve span x -949..+84 in the frontage frame and cut the west frontage from z 24 to 83 out of the
  // lots; only one southern segment survived. The east side lost Gwarna 6/8 because the fallback lot was rejected on
  // its raw 27 × 34 m raster envelope, whose bbox touches the 10.5 m roadway corridor, instead of the 20.7 × 26 m box
  // the runtime actually builds after shrinking to the 537 m² OSM area.
  const near = city.allBlocks.flatMap((b) => b.footprints)
    .filter((f) => f.x1 > -930 && f.x0 < -790 && f.z1 > 10 && f.z0 < 170);
  assert.ok(near.length > 30, `${near.length} generated footprints around Gwarna`);
  // With the south-to-north centreline, left is the west (odd numbers 3-13A), right the east (6/8 and the unnamed
  // apartments). Measured 2026-11-09: west 78.8 % (z 20-95 85.7 %), east 52.7 % (z 50-120 70.4 %). The pre-fix values
  // were 33.6 % west (0 % on its missing stretch) and 43.2 % east.
  const west = frontageCoverage(near, road, 1);
  const westZ20 = frontageCoverage(near, road, 1, 20, 95);
  const east = frontageCoverage(near, road, -1);
  const eastZ50 = frontageCoverage(near, road, -1, 50, 120);
  assert.ok(west > 0.65, `west Gwarna frontage ${(100 * west).toFixed(1)} %`);
  assert.ok(westZ20 > 0.7, `west Gwarna frontage z 20-95 ${(100 * westZ20).toFixed(1)} %`);
  assert.ok(east > 0.45, `east Gwarna frontage ${(100 * east).toFixed(1)} %`);
  assert.ok(eastZ50 > 0.55, `east Gwarna frontage z 50-120 ${(100 * eastZ50).toFixed(1)} %`);
  // Every frontage building keeps clear of the carriageway (a negative roadClearance is inside it) and of the linear
  // pedestrian corridors. Gwarna carries no tram track (GEO.rail has no tram segment in its bbox), so no extra rail check.
  const probes = (f) => {
    const pts = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
    const out = pts.slice();
    out.push({ x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2 });
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    return out;
  };
  for (const f of near) {
    for (const p of probes(f)) {
      assert.ok(config.roadClearance(p.x, p.z) >= 0, `footprint at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} reaches the Gwarna roadway`);
      assert.ok(config.pedestrianClearance(p.x, p.z) >= 0, `footprint at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} reaches a pedestrian street`);
    }
  }
});

test('Podgórna and Strzelecka keep their central street wall', async () => {
  const { config, city } = await buildCity();
  const footprintsIn = (x0, x1, z0, z1) => city.allBlocks.flatMap((b) => b.footprints).filter((f) => {
    const xs = f.pts ? f.pts.map((p) => p.x) : [f.x0, f.x1];
    const zs = f.pts ? f.pts.map((p) => p.z) : [f.z0, f.z1];
    return Math.max(...xs) > x0 && Math.min(...xs) < x1 && Math.max(...zs) > z0 && Math.min(...zs) < z1;
  });
  const named = (name, pred) => {
    const road = config.ROADS.find((r) => r.name === name && pred(r));
    assert.ok(road, `${name} segment exists`);
    return road;
  };
  const spans = (r, axis) => {
    const v = r.pts.map((p) => p[axis]);
    return [Math.min(...v), Math.max(...v)];
  };
  const strzelecka = named('Strzelecka', (r) => r.pts.length > 10 && spans(r, 'z')[0] < 400 && spans(r, 'z')[1] > 800);
  const podgorna = named('Podgórna', (r) =>
    spans(r, 'x')[0] > -160 && spans(r, 'x')[1] > -100 && spans(r, 'z')[1] < 350);
  const dluga = named('Długa', (r) => spans(r, 'x')[0] < -200 && spans(r, 'x')[1] > -100 && spans(r, 'z')[1] < 540);
  const zielona = named('Zielona', (r) => spans(r, 'x')[0] > 90);
  const ogrodowa = named('Ogrodowa', (r) => spans(r, 'x')[0] > -380 && spans(r, 'x')[1] < -240);
  // The four blocks between Podgórna and Strzelecka carry the 2026-11-09 regression: the AABB reserve of the mapped
  // objects (Kupiec Poznański, the schools on Długa/Zielona) cut whole frontage lots out of the generic perimeter
  // layout. The measured frontage coverage before/after the object-reserve fix (both sides sampled 10-30 m from the
  // centreline): Strzelecka 57.0/61.2 -> 63.9/61.7 % (59.1 -> 62.8 % combined), Podgórna's eastern stretch 30.0 ->
  // 81.7 % on its south side, Długa 59.4 -> 80.2 %, Zielona 66.7 -> 86.0 % and Ogrodowa 46.4 -> 61.6 % on its north
  // side.
  const checks = [
    ['Strzelecka west', strzelecka, footprintsIn(-220, 115, 340, 900), 1, 363, 878, 0.60],
    ['Strzelecka east', strzelecka, footprintsIn(-220, 115, 340, 900), -1, 363, 878, 0.60],
    ['Podgórna south', podgorna, footprintsIn(-190, -80, 295, 370), -1, 322, 341, 0.65],
    ['Podgórna north', podgorna, footprintsIn(-190, -80, 295, 370), 1, 322, 341, 0.85],
    ['Długa north', dluga, footprintsIn(-260, -10, 495, 560), 1, 520, 535, 0.72],
    ['Długa south', dluga, footprintsIn(-260, -10, 495, 560), -1, 520, 535, 0.72],
    ['Zielona north', zielona, footprintsIn(70, 185, 430, 485), 1, 454, 463, 0.75],
    ['Ogrodowa north', ogrodowa, footprintsIn(-390, -235, 495, 575), 1, 520, 549, 0.55],
    ['Ogrodowa south', ogrodowa, footprintsIn(-390, -235, 495, 575), -1, 520, 549, 0.70]
  ];
  for (const [label, road, near, side, z0, z1, min] of checks) {
    const share = frontageCoverage(near, road, side, z0, z1);
    assert.ok(share >= min, `${label} frontage ${(100 * share).toFixed(1)} % below ${(100 * min).toFixed(0)} %`);
  }
  const strzNear = footprintsIn(-220, 115, 340, 900);
  const strzBoth = (frontageCoverage(strzNear, strzelecka, 1, 363, 878) +
    frontageCoverage(strzNear, strzelecka, -1, 363, 878)) / 2;
  assert.ok(strzBoth >= 0.60, `Strzelecka combined frontage ${(100 * strzBoth).toFixed(1)} % below 60 %`);
  // The denser frontages still stand clear of every roadway and pedestrian corridor: the fallback tolerance only
  // accepts points within 0.5 m of the block's own property line, never a carriageway or a walking street.
  const probes = (f) => {
    const pts = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
    const out = pts.slice();
    out.push({ x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2 });
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    return out;
  };
  const guarded = new Set();
  for (const [, , near] of checks) for (const f of near) guarded.add(f);
  for (const f of guarded) {
    for (const p of probes(f)) {
      assert.ok(config.roadClearance(p.x, p.z) >= -1e-6,
        `footprint at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} reaches a roadway`);
      assert.ok(config.pedestrianClearance(p.x, p.z) >= -1e-6,
        `footprint at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} reaches a pedestrian street`);
    }
  }
});

test('framed central blocks keep their street turn and have no world-axis fallbacks', async () => {
  const { config, city } = await buildCity();
  // a033744 added fallback lots in the world frame: inside a block whose frontage frame is turned 19-43°, each one
  // stood at 0° with its neighbours at the street angle. Object minimum-area rectangles added another 2-15° of noise.
  // Every framed central detail now reports a turn; all but the mapped plans that are genuinely off every frame (kept
  // at their OSM angle to preserve the frontage) sit on a frame, and no detail in a block whose frames are all turned
  // more than 10° is left at world 0°.
  const central = new Set(['Stare Miasto', 'Jeżyce', 'Wilda', 'Łazarz']);
  const off = [];
  let checked = 0, onFrame = 0, zeroOnTurned = 0, unset = 0;
  for (const blk of city.allBlocks) {
    const src = config.BLOCKS[blk.srcBlockId];
    if (!src || !src.frames || !central.has(blk.district)) continue;
    checked++;
    if (!Number.isFinite(blk.ry)) {
      unset++;
      continue;
    }
    const best = Math.min(...src.frames.map(([th]) => Math.abs(wrapQuarter(blk.ry - th))));
    if (best <= 2 * Math.PI / 180) {
      onFrame++;
    } else {
      off.push({ id: blk.id, src: blk.srcBlockId, ry: blk.ry, best });
    }
    const allTurned = src.frames.every(([th]) => Math.abs(wrapQuarter(th)) > 10 * Math.PI / 180);
    if (allTurned && Math.abs(wrapQuarter(blk.ry)) < 0.5 * Math.PI / 180) zeroOnTurned++;
  }
  assert.ok(checked > 4000, `only ${checked} framed central block details checked`);
  assert.equal(unset, 0, `${unset} framed central block details have no turn`);
  assert.equal(zeroOnTurned, 0, `${zeroOnTurned} details stay at world 0° in fully turned blocks`);
  // 4,864 / 5,003 details sit on a frame; the rest are the mapped halls/schools whose OSM wall is off every frame.
  assert.ok(onFrame / checked > 0.95, `only ${(100 * onFrame / checked).toFixed(1)} % of details follow a street frame`);
  assert.ok(off.every((o) => Math.abs(wrapQuarter(o.ry)) > 0.5 * Math.PI / 180),
    'the details off every frame are mapped plans, not world-axis fallbacks');
});

test('Podgórna frontages keep a 2.5 m pavement clear of the roadway', async () => {
  const { config, city } = await buildCity();
  const road = config.ROADS.find((r) => r.name === 'Podgórna' && r.pts.some((p) => p.x > -160 && p.x < -100));
  assert.ok(road, 'Podgórna exists');
  const near = city.allBlocks.flatMap((b) => b.footprints).filter((f) => {
    const xs = f.pts ? f.pts.map((p) => p.x) : [f.x0, f.x1];
    const zs = f.pts ? f.pts.map((p) => p.z) : [f.z0, f.z1];
    return Math.max(...xs) > -190 && Math.min(...xs) < -80 && Math.max(...zs) > 295 && Math.min(...zs) < 370;
  });
  const probes = (f) => {
    const pts = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
    const out = pts.slice();
    out.push({ x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2 });
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
    return out;
  };
  // The mapped corner house on block 770 (way 365954909) used to put its corner 1.1 m from the lane centre corridor,
  // and Kupiec Poznański's envelope corner 1.5 m. Both now sit 2.5 m or more back, so the pavement stays walkable.
  for (const f of near) {
    for (const p of probes(f)) {
      const d = config.roadClearance(p.x, p.z);
      assert.ok(d >= 2.49,
        `footprint at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} keeps only ${d.toFixed(2)} m from the Podgórna roadway`);
    }
  }
  const cornerHouse = near.filter((f) => f.z0 > 295 && f.z1 < 316 && f.x0 > -165 && f.x1 < -140);
  assert.ok(cornerHouse.length > 0, 'the mapped Podgórna corner house on block 770 still generates');
});

test('Kupiec Poznański is a six-storey glazed-corner block clear of Podgórna', async () => {
  const { config, city } = await buildCity();
  // The OSM minimum-area rectangle: 101 x 63.7 m at 36.7°, centred at (-128.5, 364.2) on block 792. Its west and
  // north ends reach Plac Wiosny Ludów and Podgórna, so the plan is an L with a stepped cut corner and an atrium-like
  // recess, not the old 66 x 34 m diagonal box at 3 storeys.
  // Six 4.1 m glass storeys (24.6 m) and six 4.4 m sandstone storeys (26.4 m) identify the two Kupiec masses.
  const kupiecBlocks = city.allBlocks.filter((b) => b.srcBlockId === 792 &&
    b.footprints.some((f) => Math.abs(f.h - 24.6) < 0.05) &&
    b.footprints.some((f) => Math.abs(f.h - 26.4) < 0.05));
  assert.equal(kupiecBlocks.length, 1, `Kupiec builds one block detail, found ${kupiecBlocks.length}`);
  const kupiec = kupiecBlocks[0];
  const parts = kupiec.footprints;
  const area = parts.reduce((sum, f) => {
    const pts = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.z - b.x * a.z;
    }
    return sum + Math.abs(s) / 2;
  }, 0);
  const heights = new Set(parts.map((f) => Math.round(f.h * 10) / 10));
  assert.ok(parts.length >= 8, `Kupiec generates ${parts.length} wings/corner parts`);
  assert.ok(area > 4000 && area < 5000, `Kupiec covers ${area.toFixed(0)} m² (OSM outline 4,899 m²)`);
  assert.ok(heights.has(24.6) && heights.has(26.4), `Kupiec storeys ${[...heights].join(' / ')} m`);
  // Kupiec is a department store, not a courtyard block: its raw 101 x 63.7 m envelope used to seed a lawn that reached
  // 6.8 m into Plac Wiosny Ludów / Podgórna and covered the tram tracks and the pavement. It has no yard at all now.
  assert.equal(kupiec.yards.length, 0, `Kupiec still carries ${kupiec.yards.length} yard slabs`);
  const poly = config.BLOCKS[792].poly;
  for (const f of parts) {
    for (const p of probePoints(f)) {
      const d = config.roadClearance(p.x, p.z);
      assert.ok(d >= 2.49, `Kupiec keeps only ${d.toFixed(2)} m from the roadway at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      assert.ok(pointInPoly(poly, p.x, p.z), `Kupiec reaches outside block 792 at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      // A mapped-object wall may not stand on the pavement: the generated frontage lots keep SIDEWALK 4.6 m from the
      // curb. The old walls came as close as 2.7 m; the Strzelecka wall was rebuilt so the whole walk stays free.
      const curb = distanceToOutline(poly, p.x, p.z);
      assert.ok(curb >= 4.59, `Kupiec keeps only ${curb.toFixed(2)} m from the block curb at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
  // No other building on block 792 may share ground with Kupiec: the object reserve used to shrink to its OSM area
  // (88 x 55.6 m) while the mass used the full 101 x 63.7 m frame, so a kamienica generated through the south-east wing.
  const neighbours = city.allBlocks.filter((b) => b.srcBlockId === 792 && b !== kupiec).flatMap((b) => b.footprints);
  const hits = [];
  for (const f of parts) {
    const a = f.pts || [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }];
    for (const g of neighbours) {
      const b = g.pts || [{ x: g.x0, z: g.z0 }, { x: g.x1, z: g.z0 }, { x: g.x1, z: g.z1 }, { x: g.x0, z: g.z1 }];
      if (polygonsOverlap(a, b)) {
        hits.push(`Kupiec ${f.h.toFixed(1)} m at ${f.x0.toFixed(1)}, ${f.z0.toFixed(1)} / building ${g.h.toFixed(1)} m at ${g.x0.toFixed(1)}, ${g.z0.toFixed(1)}`);
      }
    }
  }
  assert.deepEqual(hits, [], `buildings overlap Kupiec on block 792: ${hits.join('; ')}`);
});

test('every courtyard slab stays inside its block, off the pavement and clear of tracks', async () => {
  const { config, city, GEO } = await buildCity();
  // The Kupiec yard was the visible case: a mapped object's raw envelope seeded a lawn across Plac Wiosny Ludów,
  // Podgórna and the tram tracks. populateBlock now drops any courtyard whose turned rectangle leaves the source
  // block's curb island, enters the 4.6 m pavement band (tools/poz-blocks.mjs SIDEWALK), crosses a pedestrian street
  // or comes within 0.5 m of a rail/tram track. The old half-metre roadway rule still left lawns over the pavement.
  const railDistance = railDistanceIndex(GEO);
  assert.ok(railDistance(GEO.rail[0].pts[0], GEO.rail[0].pts[1]) < 0.01, 'the rail index finds the tracks');
  let checked = 0;
  for (const blk of city.allBlocks) {
    const poly = config.BLOCKS[blk.srcBlockId] && config.BLOCKS[blk.srcBlockId].poly;
    assert.ok(poly && poly.length > 2, `block ${blk.srcBlockId} has a curb outline`);
    for (const y of blk.yards) {
      checked++;
      for (const p of yardProbes(y)) {
        const d = config.roadClearance(p.x, p.z);
        assert.ok(d >= 4.59, `${blk.id} yard enters the pavement at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} (${d.toFixed(2)} m)`);
        assert.ok(config.pedestrianClearance(p.x, p.z) >= 0.5,
          `${blk.id} yard reaches a pedestrian street at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
        assert.ok(railDistance(p.x, p.z) >= 0.5,
          `${blk.id} yard reaches a rail/tram track at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
        assert.ok(pointInPoly(poly, p.x, p.z), `${blk.id} yard leaves block ${blk.srcBlockId} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      }
    }
  }
  assert.ok(checked > 18000, `only ${checked} courtyard slabs checked`);
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

// A detail the quadtree refuses never streams its cornices, chimneys or roof kit. Two halls on the southern edge sat
// 23-24 m past a tree bounded by CITY_BOUNDS + 50 m until the bounds came from the details themselves.
test('every block detail is reachable through the streaming quadtree', async () => {
  const { city } = await buildCity();
  const b = city.quadtree.bounds;
  const reachable = new Set(city.quadtree.queryRange((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 1e7));
  const missing = city.allBlocks.filter((blk) => !reachable.has(blk)).map((blk) => blk.id);
  assert.equal(missing.length, 0, `not in the quadtree: ${missing.join(', ')}`);
  assert.equal(reachable.size, city.allBlocks.length);
});

// Balcony pool capacities, read from js/balconies.js and js/buildings.js so the test cannot drift from them
const balconySource = readFileSync(join(__dirname, '../js/balconies.js'), 'utf8');
const sourceConst = (text, name) => Number(text.match(new RegExp(`^ *const ${name} = (\\d+);`, 'm'))[1]);
const MAX_STACKS = sourceConst(balconySource, 'MAX_STACKS');
const MAX_NEAR_BALCONIES = sourceConst(balconySource, 'MAX_NEAR_BALCONIES');
const NEAR_DISTANCE = sourceConst(balconySource, 'NEAR_DISTANCE');
const STREAM_RADIUS = sourceConst(source, 'STREAM_RADIUS');

// Blocks within STREAM_RADIUS, nearest centre first, as the buildings update streams them
function streamedBlocks(city, focusX, focusZ) {
  const nearby = city.quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
  nearby.sort((a, b) => {
    const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
    const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
    return da - db;
  });
  return nearby;
}

function evaluateBalconiesAt(city, focusX, focusZ) {
  let total = 0;
  let totalStacksInRange = 0;
  for (const blk of streamedBlocks(city, focusX, focusZ)) {
    for (const b of blk.balconies || []) {
      totalStacksInRange++;
      if (total < MAX_STACKS) total++;
    }
  }
  return { total, totalStacksInRange, dropped: totalStacksInRange - total };
}

// The real js/balconies.js on a three.js stand-in whose InstancedMesh keeps its count and the position of every
// instance written, and refuses a slot past its capacity
function createBalconyPools() {
  const stub = anything();
  const meshes = [];
  class Object3D {
    constructor() {
      const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
      this.position = vec();
      this.rotation = vec();
      this.scale = vec();
      this.matrix = null;
    }
    updateMatrix() {
      this.matrix = { x: this.position.x, y: this.position.y, z: this.position.z };
    }
  }
  class InstancedMesh {
    constructor(_geometry, _material, capacity) {
      this.capacity = capacity;
      this.count = 0;
      this.slots = [];
      this.instanceMatrix = stub;
    }
    setMatrixAt(i, m) {
      if (i >= this.capacity) throw new Error(`instance ${i} past capacity ${this.capacity}`);
      this.slots[i] = m;
    }
  }
  const three = new Proxy({ Object3D, InstancedMesh }, { get: (t, key) => (key in t ? t[key] : stub) });
  const { createBalconies } = loadModule(balconySource, {
    imports: { 'three/webgpu': three, 'three/tsl': stub },
    globals: { Math, Array, Float32Array, Error },
    filename: 'balconies.js'
  });
  const system = createBalconies({ add: (mesh) => meshes.push(mesh) });
  return { system, near: meshes[0], far: meshes[1] };
}

test('near balcony landings stay within 85 % of MAX_NEAR_BALCONIES on a 10 m focus grid', async () => {
  const { city } = await buildCity();
  // Near demand at a focus is the landings of every stack within NEAR_DISTANCE. Stamp each stack onto the 10 m grid
  // points inside its circle; that covers every point where any stack is near, ~307k points city-wide.
  const STEP = 10;
  const demand = new Map();
  for (const blk of city.allBlocks) {
    for (const b of blk.balconies) {
      for (let x = Math.ceil((b.x - NEAR_DISTANCE) / STEP) * STEP; x <= b.x + NEAR_DISTANCE; x += STEP) {
        for (let z = Math.ceil((b.z - NEAR_DISTANCE) / STEP) * STEP; z <= b.z + NEAR_DISTANCE; z += STEP) {
          if ((x - b.x) ** 2 + (z - b.z) ** 2 >= NEAR_DISTANCE * NEAR_DISTANCE) continue;
          const key = x * 100000 + z;
          demand.set(key, (demand.get(key) || 0) + b.landings);
        }
      }
    }
  }
  const peaks = [...demand.entries()].sort((p, q) => q[1] - p[1]).slice(0, 5)
    .map(([key, want]) => {
      const x = Math.round(key / 100000);
      return { x, z: key - x * 100000, want };
    });
  // 282 at (-690, 1820) in Wilda on 2026-11-10, over the old 256 pool; 85 % of 384 is 326.
  const peak = peaks[0];
  assert.ok(peak.want <= 0.85 * MAX_NEAR_BALCONIES,
    `peak near demand ${peak.want} at (${peak.x}, ${peak.z}) above 85 % of MAX_NEAR_BALCONIES (${MAX_NEAR_BALCONIES})`);

  // At the densest foci the real pool, fed in the production block order, admits every near landing
  const pools = createBalconyPools();
  for (const { x, z, want } of peaks) {
    pools.system.begin();
    for (const blk of streamedBlocks(city, x, z)) for (const b of blk.balconies) pools.system.add(b, x, z);
    pools.system.end();
    assert.equal(pools.near.count, want, `near landings at (${x}, ${z})`);
  }
});

test('the near balcony pool admits the nearest stacks first and sends the rest to far boxes', () => {
  const { system, near, far } = createBalconyPools();
  // Six-storey stacks on a line 10-80 m out, fed farthest first: more landings than the pool holds
  const stacks = [];
  const count = Math.ceil(MAX_NEAR_BALCONIES / 6) + 8;
  for (let i = 0; i < count; i++) {
    const d = 10 + 70 * (1 - i / (count - 1));
    stacks.push({ x: d, y: 4, z: 0, facing: 0, storey: 3.2, landings: 6, h: 19 });
  }
  system.begin();
  for (const b of stacks) system.add(b, 0, 0);
  system.end();
  const admitted = Math.floor(MAX_NEAR_BALCONIES / 6);
  assert.equal(near.count, admitted * 6);
  assert.equal(far.count, count - admitted);
  const farthestNear = Math.max(...near.slots.slice(0, near.count).map((m) => m.x));
  const nearestFar = Math.min(...far.slots.slice(0, far.count).map((m) => m.x));
  assert.ok(farthestNear < nearestFar, `near stack at ${farthestNear} m beyond a far box at ${nearestFar} m`);
});

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

