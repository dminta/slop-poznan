// tools/density-report.mjs — generated vs OSM built share for every BLOCKS entry, using the same headless path as
// tests/buildings-density.test.cjs: buildCityBlocks() against virtual three.js stubs, then the 2 m footprint raster
// (each cell counted once for the block under its centre). It also reports how much of each curb island the GEO lot
// rects cover, how much of that lot area is actually built, and how much landmark reserve / park carve takes away.
// Three numbers separate the causes:
//   rects  — raw GEO lot rects over the curb island (property line after the 4.6 m sidewalk erosion, fitRects output)
//   lots   — effective pieces after parkFreeCells, splitDeep and the min-lot filter (city-config blockLots)
//   fill   — generated ground footprint over those effective pieces
//
// Usage: node tools/density-report.mjs [--top 30] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = readFileSync(join(root, 'js/buildings.js'), 'utf8');

// Stand-in for three.js, TSL, the materials, roofs and balconies: every property, call and `new` gives another
// stand-in, so the scene half of buildCityBlocks runs through while the lot layout (the part measured) is real
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

const config = await import(pathToFileURL(join(root, 'js/city-config.js')).href);
const { GEO } = await import(pathToFileURL(join(root, 'js/geodata.js')).href);
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

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const c = poly[j];
    if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// The test raster uses blockAt(), which returns the first block in its 64 m grid cell and deliberately ignores cells
// under roadCut / tramCut. Two corrections matter for per-block numbers:
// - a donut-shaped island (887, 85 ha) has a single outline ring with no hole, so blockAt returns it for the nested
//   island in its courtyard (913) and the inner block loses that footprint;
// - an anchor hall spanning a rail depot's track corridor (1250) has no blockAt at all.
// The corrected raster takes the smallest block polygon containing the cell, ignoring the road/tram cuts; a point on
// an ordinary roadway is still outside every block polygon and is never assigned.
const TILE = 64;
const tileBlocks = new Map();
function candidatesAt(x, z) {
  const key = Math.floor(x / TILE) * 100000 + Math.floor(z / TILE);
  let list = tileBlocks.get(key);
  if (!list) {
    const x0 = Math.floor(x / TILE) * TILE, z0 = Math.floor(z / TILE) * TILE;
    list = config.blocksInRect(x0, x0 + TILE, z0, z0 + TILE);
    tileBlocks.set(key, list);
  }
  return list;
}
function smallestBlockAt(x, z) {
  let best = null;
  for (const b of candidatesAt(x, z)) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (!b.rect && !pointInPoly(b.poly, x, z)) continue;
    if (!best || b.area < best.area) best = b;
  }
  return best;
}

const t0 = Date.now();
const city = buildCityBlocks(stub);
const buildMs = Date.now() - t0;

// Footprints on a 2 m raster, each cell counted once for the block under it. gen = the strict test-harness count;
// genAll takes the smallest containing block and ignores road/tram cuts, which is the physical curb island.
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
  const genAll = new Map();
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      if (!cells[j * RW + i]) continue;
      const x = B.minX + (i + 0.5) * C;
      const z = B.minZ + (j + 0.5) * C;
      const b = config.blockAt(x, z);
      if (b) gen.set(b.id, (gen.get(b.id) || 0) + C * C);
      const s = smallestBlockAt(x, z);
      if (s) genAll.set(s.id, (genAll.get(s.id) || 0) + C * C);
    }
  }
  return { gen, genAll };
}

const t1 = Date.now();
const { gen, genAll } = generatedByBlock(config, city);
const rasterMs = Date.now() - t1;

// Landmark reserves exactly as js/buildings.js defines them: every footprint in the list, or its curbside model, as
// an AABB grown by 3 m. The generic generator clears these from its lot rects; landmarks*.js builds them instead.
const RESERVE_MARGIN = 3;
const landmarkRects = [
  'Ratusz', 'Wieża Wójtowska', 'Domki Budnicze', 'Fara', 'Zamek Królewski', 'Katedra', 'Brama Poznania',
  'Zamek Cesarski', 'Bałtyk', 'Okrąglak', 'Collegium Minus', 'Teatr Wielki', 'Pomnik Czerwca 1956', 'Poznań Główny',
  'Stary Dworzec', 'Avenida', 'Stary Browar', 'Iglica', 'Collegium Altum', 'Andersia', 'Poznań Financial Centre',
  'Novotel', 'AND2', 'Nowy Rynek', 'Delta', 'Biblioteka Raczyńskich', 'Pałac Działyńskich', 'Hotel Bazar',
  'Muzeum Narodowe', 'Teatr Polski', 'Collegium Maius', 'Kościół Bernardynów', 'Kościół Franciszkanów',
  'Kościół Najświętszej Marii Panny', 'Kościół św. Wojciecha', 'Kościół Bożego Ciała'
].map((name) => config.LANDMARK_SITES[name]).filter(Boolean).map((t) => {
  let xs = [], zs = [];
  if (t.ring && t.ring.length >= 6) {
    for (let i = 0; i + 1 < t.ring.length; i += 2) {
      xs.push(t.ring[i]);
      zs.push(t.ring[i + 1]);
    }
  } else {
    const c = Math.cos(t.ang || 0), sn = Math.sin(t.ang || 0);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (u * t.w) / 2, lz = (v * t.d) / 2;
      xs.push(t.x + lx * c + lz * sn);
      zs.push(t.z - lx * sn + lz * c);
    }
  }
  return {
    x0: Math.min(...xs) - RESERVE_MARGIN, x1: Math.max(...xs) + RESERVE_MARGIN,
    z0: Math.min(...zs) - RESERVE_MARGIN, z1: Math.max(...zs) + RESERVE_MARGIN
  };
});

// Raw lot rects in their own frames, plus a world point test used for the park / landmark sampling.
const rawFrames = (b) => (b.frames || [[0, 0, 0, b.rects]]).map(([th, px, pz, rects]) => ({
  cs: Math.cos(th), sn: Math.sin(th), px, pz, rects
}));
const sumRectArea = (b) => rawFrames(b).reduce((t, f) => t + f.rects.reduce((s, r) =>
  s + Math.max(0, r[1] - r[0]) * Math.max(0, r[3] - r[2]), 0), 0);
function inRawRect(b, x, z) {
  for (const f of rawFrames(b)) {
    const dx = x - f.px, dz = z - f.pz;
    const lx = f.px + dx * f.cs - dz * f.sn;
    const lz = f.pz + dx * f.sn + dz * f.cs;
    for (const r of f.rects) {
      if (lx > r[0] && lx < r[1] && lz > r[2] && lz < r[3]) return true;
    }
  }
  return false;
}
const effectiveLotArea = (b) => {
  if (!b.buildings || b.median) return 0;
  return config.blockLots(b).reduce((t, p) => t + (p.x1 - p.x0) * (p.z1 - p.z0), 0);
};

// Sample reserve / raw-rect coverage on 2 m cells inside each block polygon (only reserves overlapping its bbox).
function coverage(b) {
  const C = 2;
  const x0 = Math.floor(b.minX / C) * C, x1 = Math.ceil(b.maxX / C) * C;
  const z0 = Math.floor(b.minZ / C) * C, z1 = Math.ceil(b.maxZ / C) * C;
  const rs = landmarkRects.filter((r) => r.x1 > b.minX && r.x0 < b.maxX && r.z1 > b.minZ && r.z0 < b.maxZ);
  let blockCells = 0, rectCells = 0, reserveCells = 0, reserveRectCells = 0;
  for (let z = z0 + 1; z < z1; z += C) {
    for (let x = x0 + 1; x < x1; x += C) {
      if (!b.rect && !pointInPoly(b.poly, x, z)) continue;
      blockCells++;
      const rect = inRawRect(b, x, z);
      if (rect) rectCells++;
      if (rs.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) {
        reserveCells++;
        if (rect) reserveRectCells++;
      }
    }
  }
  const cells = blockCells || 1;
  return { rectCover: rectCells / cells, reserveCover: reserveCells / cells, reserveRectCover: reserveRectCells / cells };
}

const OFFICE_SITES = ['Bałtyk', 'Andersia', 'AND2', 'Poznań Financial Centre', 'Collegium Altum']
  .map((name) => config.LANDMARK_SITES[name]).filter(Boolean);
const nearOffice = (b) => OFFICE_SITES.some((s) => Math.hypot(s.x - b.cx, s.z - b.cz) < 240);

// Best-effort morphology label mirroring blockProfile's gates, for grouping only (the profile can still change with
// the lot frame's world centre and the random stream).
function morphology(b) {
  if (b.program) return ['', 'szpital/kampus', 'kampus uniwersytecki', 'handel/mall', 'przemysł/hale', 'kolej/zajezdnia',
    'sport/stadion', 'infrastruktura', 'rekreacja'][b.program] || `program ${b.program}`;
  if (b.park > 0.6) return 'park';
  if (nearOffice(b)) return 'biura';
  const lv = b.levels;
  if (lv >= 7) return 'wielka płyta';
  if (lv >= 4) return 'kamienice/średniowysokie';
  if (lv >= 1) return 'wille/niska zabudowa';
  return 'bez poziomów OSM';
}

const buildable = (b) => !((b.park > 0.6 && !b.buildings) || b.median);

const rows = config.BLOCKS.map((b) => {
  const generated = gen.get(b.id) || 0;
  const generatedAll = genAll.get(b.id) || 0;
  const real = b.built * b.area;
  const lot = effectiveLotArea(b);
  const cov = coverage(b);
  return {
    id: b.id,
    district: b.district || '(poza dzielnicami)',
    areaHa: b.area / 1e4,
    real,
    generated,
    generatedAll,
    ratio: real > 0 ? generatedAll / real : 0,
    ratioStrict: real > 0 ? generated / real : 0,
    missing: real - generatedAll,
    missingStrict: real - generated,
    built: b.built,
    genShare: b.area > 0 ? generatedAll / b.area : 0,
    park: b.park,
    program: b.program,
    levels: b.levels,
    buildings: b.buildings,
    rectCover: cov.rectCover,
    reserveCover: cov.reserveCover,
    reserveRectCover: cov.reserveRectCover,
    lotCover: b.area > 0 ? lot / b.area : 0,
    fill: lot > 0 ? generatedAll / lot : 0,
    kind: morphology(b),
    buildable: buildable(b)
  };
});

const sum = (list, key) => list.reduce((t, r) => t + r[key], 0);
function aggregate(list) {
  const area = sum(list, 'areaHa') * 1e4;
  const real = sum(list, 'real');
  const generated = sum(list, 'generatedAll');
  return { blocks: list.length, areaHa: area / 1e4, real: real / area, generated: generated / area,
    ratio: real > 0 ? generated / real : 0, missing: real - generated };
}

const districts = [...new Set(rows.map((r) => r.district))].sort();
const districtRows = districts.map((district) => ({
  district,
  all: aggregate(rows.filter((r) => r.district === district && r.real > 0)),
  buildable: aggregate(rows.filter((r) => r.district === district && r.buildable && r.real > 0))
}));

const top = rows.filter((r) => r.buildable && r.real > 0).sort((a, b) => b.missing - a.missing);
const low = rows.filter((r) => r.buildable && r.built >= 0.25 && r.ratio < 0.5)
  .sort((a, b) => a.ratio - b.ratio || b.missing - a.missing);

function pct(v) { return `${(100 * v).toFixed(1)}%`; }
function m2(v) { return Math.round(v).toLocaleString('pl-PL'); }

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const topN = arg('--top', 30);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;

const total = aggregate(rows.filter((r) => r.real > 0));
const totalBuildable = aggregate(rows.filter((r) => r.buildable && r.real > 0));
const strictMiss = rows.filter((r) => r.buildable && r.real > 0).reduce((t, r) => t + (r.missingStrict - r.missing), 0);
console.log(`buildCityBlocks ${buildMs} ms, 2 m raster ${rasterMs} ms, ${rows.length} blocks`);
console.log(`all blocks with OSM buildings: ${total.blocks}, ${total.areaHa.toFixed(1)} ha, real ${pct(total.real)}, ` +
  `generated ${pct(total.generated)} (${total.ratio.toFixed(3)}), missing ${m2(total.missing)} m²`);
console.log(`buildable blocks: ${totalBuildable.blocks}, ${totalBuildable.areaHa.toFixed(1)} ha, real ` +
  `${pct(totalBuildable.real)}, generated ${pct(totalBuildable.generated)} (${totalBuildable.ratio.toFixed(3)}), ` +
  `missing ${m2(totalBuildable.missing)} m²`);
console.log(`smallest-containing-block correction vs the test harness: ${m2(strictMiss)} m²`);

console.log('\n## Districts (buildable blocks)\n');
console.log('| district | blocks | area ha | OSM real | generated | gen/real | missing m² |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const d of districtRows.filter((d) => d.buildable.blocks > 0).sort((a, b) => b.buildable.missing - a.buildable.missing)) {
  const a = d.buildable;
  console.log(`| ${d.district} | ${a.blocks} | ${a.areaHa.toFixed(1)} | ${pct(a.real)} | ${pct(a.generated)} | ` +
    `${a.ratio.toFixed(3)} | ${m2(a.missing)} |`);
}

console.log(`\n## TOP ${topN} absolute deficit (buildable blocks)\n`);
console.log('| # | id | district | kind | area ha | OSM built | generated | gen/real | missing m² | rects | reserve | lots | fill |');
console.log('| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
top.slice(0, topN).forEach((r, i) => {
  console.log(`| ${i + 1} | ${r.id} | ${r.district} | ${r.kind} | ${r.areaHa.toFixed(2)} | ${pct(r.built)} | ` +
    `${pct(r.genShare)} | ${r.ratio.toFixed(3)} | ${m2(r.missing)} | ${pct(r.rectCover)} | ${pct(r.reserveRectCover)} | ` +
    `${pct(r.lotCover)} | ${pct(r.fill)} |`);
});

console.log(`\n## low ratio: OSM built >= 25%, generated < 50% real (${low.length} blocks)\n`);
console.log('| # | id | district | kind | area ha | OSM built | generated | gen/real | missing m² | reserve | lots | fill |');
console.log('| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
low.slice(0, topN).forEach((r, i) => {
  console.log(`| ${i + 1} | ${r.id} | ${r.district} | ${r.kind} | ${r.areaHa.toFixed(2)} | ${pct(r.built)} | ` +
    `${pct(r.genShare)} | ${r.ratio.toFixed(3)} | ${m2(r.missing)} | ${pct(r.reserveRectCover)} | ${pct(r.lotCover)} | ` +
    `${pct(r.fill)} |`);
});

console.log('\n## By morphology (buildable blocks)\n');
console.log('| kind | blocks | area ha | OSM real | generated | gen/real | rects | reserve | lots | fill | missing m² |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
const kindArea = (list, key) => list.reduce((t, r) => t + r[key] * r.areaHa * 1e4, 0) /
  Math.max(1, list.reduce((t, r) => t + r.areaHa * 1e4, 0));
const kinds = [...new Set(rows.filter((r) => r.buildable).map((r) => r.kind))];
for (const kind of kinds) {
  const list = rows.filter((r) => r.buildable && r.kind === kind && r.real > 0);
  const a = aggregate(list);
  console.log(`| ${kind} | ${a.blocks} | ${a.areaHa.toFixed(1)} | ${pct(a.real)} | ${pct(a.generated)} | ` +
    `${a.ratio.toFixed(3)} | ${pct(kindArea(list, 'rectCover'))} | ${pct(kindArea(list, 'reserveRectCover'))} | ` +
    `${pct(kindArea(list, 'lotCover'))} | ${pct(kindArea(list, 'fill'))} | ${m2(a.missing)} |`);
}

const byProgram = new Map();
for (const r of rows.filter((x) => x.buildable && x.program)) {
  const p = byProgram.get(r.program) || [];
  p.push(r);
  byProgram.set(r.program, p);
}
console.log('\n## By block program (buildable blocks)\n');
console.log('| program | blocks | area ha | OSM real | generated | gen/real | missing m² |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [p, list] of [...byProgram].sort((a, b) => a[0] - b[0])) {
  const a = aggregate(list.filter((r) => r.real > 0));
  console.log(`| ${p} | ${a.blocks} | ${a.areaHa.toFixed(1)} | ${pct(a.real)} | ${pct(a.generated)} | ` +
    `${a.ratio.toFixed(3)} | ${m2(a.missing)} |`);
}

console.log('\n## Aggregate lot budget (buildable blocks)\n');
const areaAll = totalBuildable.areaHa * 1e4;
const rectArea = rows.filter((r) => r.buildable).reduce((t, r) => t + r.rectCover * r.areaHa * 1e4, 0);
const reserveArea = rows.filter((r) => r.buildable).reduce((t, r) => t + r.reserveRectCover * r.areaHa * 1e4, 0);
const lotArea = rows.filter((r) => r.buildable).reduce((t, r) => t + r.lotCover * r.areaHa * 1e4, 0);
const genArea = totalBuildable.generated * areaAll;
console.log(`island ${m2(areaAll)} m² → raw rects ${pct(rectArea / areaAll)} (${m2(rectArea)} m²) → landmark reserves ` +
  `inside rects ${pct(reserveArea / areaAll)} (${m2(reserveArea)} m²) → effective lots ${pct(lotArea / areaAll)} ` +
  `(${m2(lotArea)} m²) → generated ${pct(genArea / areaAll)} (${m2(genArea)} m²)`);

if (jsonPath) {
  writeFileSync(join(root, jsonPath), JSON.stringify({ city: { buildMs, rasterMs }, totals: { total, totalBuildable },
    districts: districtRows, rows, top, low }, null, 2));
  console.log(`\nJSON written to ${jsonPath}`);
}
