// tools/audit-nonresidential.mjs — audit of non-residential OSM buildings (malls, stations, depots, industry, halls,
// stadiums, campuses, hospitals) against what js/buildings.js actually generates on their blocks. Prints a summary and
// writes a JSON report.
//
// usage: node --max-old-space-size=8192 tools/audit-nonresidential.mjs [out.json]
//
// Method: tools/poz-buildings.mjs rasterises the real footprints on the block raster and assigns each footprint to a
// block (its centroid's block, else the block holding most cells). We reuse that exact assignment, join the raw OSM tags
// by element id and classify. The simulation side runs js/buildings.js in the test harness (tests/helpers/module.cjs,
// inert three.js/TSL) and rasterises its footprints on a 2 m grid, as tests/buildings-density.test.cjs does.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const { GEO } = await import('../js/geodata.js');
const { blocks } = await import('./poz-blocks.mjs');
const { buildings, blockStats } = await import('./poz-buildings.mjs');
const { elemRings, scanRings } = await import('./geo-util.mjs');
const { toWorld } = await import('./poz-base.mjs');

const OUT = process.argv[2] || fileURLToPath(new URL('./audit-nonresidential.json', import.meta.url));
const RAW = JSON.parse(readFileSync(fileURLToPath(new URL('./data/poz_buildings.json', import.meta.url)), 'utf8'));
const tagsById = new Map(RAW.elements.map((e) => [e.id, e.tags || {}]));

const [a, b, c, d, e, f] = GEO.frame.ll;
const toWorldLL = (lon, lat) => [a * lon + b * lat + c, d * lon + e * lat + f];
const q = (v) => Math.round(v * 10) / 10;
const list = (v) => String(v || '').toLowerCase().split(';').map((s) => s.trim()).filter(Boolean);

// --- Classification ------------------------------------------------------------------------------------------------
// Categories keep the wording of the brief: retail (malls / large-format), rail, industrial, leisure, civic
// (universities / hospitals / schools), office (commercial offices, reported separately) and other.
const RETAIL = new Set(['retail', 'commercial', 'supermarket', 'department_store', 'wholesale', 'kiosk', 'stall', 'shop',
  'marketplace', 'hall']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'warehouses', 'factory', 'manufacture', 'hangar', 'shed', 'service',
  'utility', 'transformer_tower', 'water_tower', 'storage_tank', 'silo', 'greenhouse', 'barn', 'stable',
  'digester', 'gasometer', 'cooling_tower', 'slurry_tank']);
const RAIL = new Set(['train_station', 'transportation', 'station', 'railway_station', 'bus_station']);
const LEISURE = new Set(['stadium', 'sports_hall', 'sports_centre', 'arena', 'exhibition_centre', 'museum', 'theatre',
  'cinema', 'community_centre', 'cultural_centre', 'riding_hall', 'ice_rink', 'aquarium', 'gallery',
  'amusement_arcade']);
const CIVIC = new Set(['university', 'college', 'school', 'dormitory', 'hospital', 'kindergarten', 'public', 'civic',
  'government', 'library', 'military']);
const MALL_NAME = /posnania|avenida|stary browar|kupiec|galeria (panorama|pestka|mm|polskie meble)|king cross|poznań plaza|^m1\b|castorama|makro|centrum handlowe|centrum handlowe|pawilon \d|targi|^mtp\b/i;
const RAIL_NAME = /dworzec|zajezdni|parowozownia|pkp|kolejow|zntk|bocznica|lokomotyw/i;
const INDUSTRIAL_NAME = /elektrociepłowni|elektrocieplowni|zakład|zaklad|hala (produkcyjna|zajezdni)|warsztat|hcp|cegielski|volkswagen|spalarni|oczyszczalni|magazyn|hurtowni|chłodni|chlodni|fabryk|kopalni|cukrowni/i;
const LEISURE_NAME = /stadion|arena|hala sportowa|term[y|y ]|lodowisko|basen|pływalni|plywalni|tor regat|korty|hala widowiskow|muzeum|teatr|kino|filharmoni|opera/i;
const CIVIC_NAME = /szpital|klinik|politechnik|uniwers|collegium|akadem|awf|instytut|szkoła|szkola|liceum|technikum|urząd|urzad|sąd|sad|bibliotek|kampus|rektorat/i;

function classify(t) {
  const kinds = list(t.building);
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  // Untagged industrial / leisure sites whose function is only in an address or a historical tag
  if (t['addr:street'] === 'Termalna') return ['leisure', 'water_park (address)'];
  if (t['historic:power']) return ['industrial', kinds.join(';') || 'generator'];
  if (kinds.includes('ruins') || kinds.includes('grandstand')) {
    const text = `${t.wikipedia || ''} ${t.wikidata || ''} ${name}`;
    if (/zntk|naprawcze|zakłady|warsztat/i.test(text)) return ['industrial', 'ruins'];
    if (kinds.includes('grandstand')) return ['leisure', 'grandstand'];
    return [null, kinds.join(';')];
  }
  // A building tagged with a mall name wins over the generic `building=commercial` of its parts
  if (MALL_NAME.test(name) && !/administracja/i.test(name)) return ['retail', kinds.join(';') || 'named'];
  if (kinds.some((k) => RAIL.has(k)) || t.railway || t.public_transport === 'station' || RAIL_NAME.test(name)) return ['rail', kinds.join(';')];
  if (kinds.some((k) => CIVIC.has(k)) || t.amenity === 'hospital' || t.amenity === 'university' ||
    t.amenity === 'college' || t.amenity === 'school' || t.healthcare || t.office === 'university' ||
    CIVIC_NAME.test(name)) return ['civic', kinds.join(';')];
  if (kinds.some((k) => LEISURE.has(k)) || LEISURE.has(t.leisure) || LEISURE.has(t.tourism) ||
    ['theatre', 'cinema', 'museum', 'arts_centre', 'exhibition_centre', 'conference_centre', 'community_centre'].includes(t.amenity) ||
    LEISURE_NAME.test(name)) return ['leisure', kinds.join(';')];
  if (kinds.some((k) => RETAIL.has(k)) || t.shop || t.amenity === 'marketplace') return ['retail', kinds.join(';')];
  if (kinds.some((k) => INDUSTRIAL.has(k)) || t.man_made === 'works' || t.man_made === 'storage_tank' ||
    t.power === 'plant' || t.power === 'substation' || t.landuse === 'industrial' || t.landuse === 'railway' ||
    INDUSTRIAL_NAME.test(name)) return ['industrial', kinds.join(';')];
  if (kinds.includes('office') || t.office) return ['office', kinds.join(';')];
  return [null, kinds.join(';')];
}

// --- Real buildings joined to blocks -------------------------------------------------------------------------------
// Centroid lon/lat of every raw element, for the world coordinate beside each record (the block comes from the raster)
const lonLatById = new Map();
for (const el of RAW.elements) {
  let lat = 0, lon = 0, n = 0;
  const push = (g) => { for (const p of g || []) { lat += p.lat; lon += p.lon; n++; } };
  if (el.geometry) push(el.geometry);
  for (const m of el.members || []) push(m.geometry);
  if (n) lonLatById.set(el.id, [lon / n, lat / n]);
}

const blockByLabel = new Map(blocks.map((bl) => [bl.label, bl]));
const blockIndexById = new Map(blocks.map((bl, i) => [bl.id, i]));
const realByBlock = new Map(); // block id -> { retail, rail, industrial, leisure, civic, office, other }
const records = [];
const catOf = (t) => classify(t)[0];
let totalNonres = 0, totalNonresArea = 0;
const skippedRoof = [];

for (const bd of buildings) {
  const t = tagsById.get(bd.id) || {};
  const cat = catOf(t);
  if (!cat) continue;
  const bl = bd.label ? blockByLabel.get(bd.label) : null;
  const blockId = bl ? bl.id : null;
  const name = t.name || t['name:pl'] || '';
  if (!realByBlock.has(blockId)) realByBlock.set(blockId, { retail: 0, rail: 0, industrial: 0, leisure: 0, civic: 0, office: 0 });
  realByBlock.get(blockId)[cat] += bd.cells;
  totalNonres++;
  totalNonresArea += bd.area;
  const [x, z] = toWorldLL(...(lonLatById.get(bd.id) || [GEO.frame.lon0, GEO.frame.lat0]));
  records.push({
    id: bd.id, name, cat, kind: t.building || '', levels: bd.levels || 0,
    area: Math.round(bd.area), cells: bd.cells, blockId, x: q(x), z: q(z),
    landmark: nearestLandmark(x, z), landmarkModel: landmarkModelAt(x, z, name)
  });
}
for (const e of RAW.elements) {
  const t = e.tags || {};
  if (t.building === 'roof' && catOf(t)) skippedRoof.push({ id: e.id, name: t.name || t['name:pl'] || '', kind: t.building });
}

function nearestLandmark(x, z) {
  let best = null, bd = Infinity;
  for (const [name, s] of Object.entries(GEO.landmarks)) {
    const dd = Math.hypot(s.x - x, s.z - z);
    if (dd < bd) { bd = dd; best = name; }
  }
  return bd <= 120 ? { name: best, distance: Math.round(bd) } : null;
}
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// The landmark models are hand-built from the same OSM outlines, so a footprint inside one is present in the scene
// even though js/buildings.js left the reserve empty
function landmarkModelAt(x, z, name) {
  for (const [lm, s] of Object.entries(GEO.landmarks)) {
    if (s.ring && s.ring.length >= 6 && pointInRing(x, z, s.ring)) return lm;
    const reach = Math.max(s.w, s.d) * 0.5 + 12;
    if (name && Math.hypot(s.x - x, s.z - z) <= reach && (name.includes(lm) || lm.includes(name))) return lm;
  }
  return null;
}

// --- Generated footprints per block --------------------------------------------------------------------------------
async function generate() {
  const config = await import('../js/city-config.js');
  const source = readFileSync(fileURLToPath(new URL('../js/buildings.js', import.meta.url)), 'utf8');
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
  const city = buildCityBlocks(stub);
  const B = config.CITY_BOUNDS;
  const C = 2;
  const RW = Math.ceil((B.maxX - B.minX) / C);
  const RH = Math.ceil((B.maxZ - B.minZ) / C);
  const cells = new Uint8Array(RW * RH);
  const heights = new Float32Array(RW * RH);
  const inQuad = (pts, x, z) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const p = pts[i], n = pts[(i + 1) % 4];
      const cc = (n.x - p.x) * (z - p.z) - (n.z - p.z) * (x - p.x);
      if (cc > 0) s |= 1;
      else if (cc < 0) s |= 2;
    }
    return s !== 3;
  };
  for (const blk of city.allBlocks) {
    for (const fp of blk.footprints) {
      const i0 = Math.max(0, Math.floor((fp.x0 - B.minX) / C));
      const i1 = Math.min(RW - 1, Math.floor((fp.x1 - B.minX) / C));
      const j0 = Math.max(0, Math.floor((fp.z0 - B.minZ) / C));
      const j1 = Math.min(RH - 1, Math.floor((fp.z1 - B.minZ) / C));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = B.minX + (i + 0.5) * C, z = B.minZ + (j + 0.5) * C;
          if (!fp.pts || inQuad(fp.pts, x, z)) {
            const k = j * RW + i;
            cells[k] = 1;
            if ((fp.h || 0) > heights[k]) heights[k] = fp.h || 0;
          }
        }
      }
    }
  }
  const gen = new Map();
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      if (!cells[j * RW + i]) continue;
      const blk = config.blockAt(B.minX + (i + 0.5) * C, B.minZ + (j + 0.5) * C);
      if (blk) gen.set(blk.id, (gen.get(blk.id) || 0) + C * C);
    }
  }
  const anyByBlock = new Map();
  const heightByBlock = new Map();
  for (const blk of city.allBlocks) {
    if (!blk.footprints.length) continue;
    const id = blk.srcBlockId;
    if (id === null || id === undefined) continue;
    anyByBlock.set(id, true);
    let mx = 0;
    for (const fp of blk.footprints) mx = Math.max(mx, fp.h || 0);
    heightByBlock.set(id, Math.max(heightByBlock.get(id) || 0, mx));
  }
  return { config, city, gen, anyByBlock, heightByBlock, B, C, RW, RH, cells, heights };
}

const { config, city, gen, anyByBlock, heightByBlock, B, C, RW, RH, cells: generatedCells, heights: generatedHeights } =
  await generate();
const GEN_RASTER = { x0: B.minX, z0: B.minZ, res: C, w: RW, h: RH };
const elementsById = new Map(RAW.elements.map((el) => [el.id, el]));
// Share of a real footprint covered by generated footprints, plus the generated heights over it (2 m cells)
function coverage(id) {
  const el = elementsById.get(id);
  if (!el) return null;
  const outer = elemRings(el, toWorld).filter((r) => r.length > 3);
  if (!outer.length) return null;
  const inner = elemRings(el, toWorld, 'inner').filter((r) => r.length > 3);
  let n = 0, cov = 0, hmax = 0, hsum = 0;
  scanRings(inner.length ? outer.concat(inner) : outer, GEN_RASTER, (i, j) => {
    const k = j * RW + i;
    n++;
    if (generatedCells[k]) {
      cov++;
      const h = generatedHeights[k];
      hsum += h;
      if (h > hmax) hmax = h;
    }
  });
  const cellArea = GEN_RASTER.res * GEN_RASTER.res;
  return { inBox: Math.round(n * cellArea), covered: Math.round(cov * cellArea), share: n ? cov / n : 0,
    hmax: Math.round(hmax * 10) / 10, hmean: cov ? Math.round((hsum / cov) * 10) / 10 : 0 };
}

for (const r of records) {
  const cv = coverage(r.id);
  r.generated = cv && cv.inBox ? cv : null;
}

// --- Curated sites from the brief ---------------------------------------------------------------------------------
// Each row aggregates all OSM elements that make up the site (a mall has a hall and a parking deck, a campus several
// wings). Elements absent from the snapshot are reported as such: the padded fetch box, not the generator, is then the
// reason.
const TARGETS = [
  ['CH Posnania', 'retail', [390832753]],
  ['CH Avenida', 'retail', [368791550, 368791540]],
  ['Stary Browar', 'retail', [181129696, 199048095]],
  ['Kupiec Poznański', 'retail', [35277661]],
  ['Galeria MM', 'retail', [427983275]],
  ['Galeria Polskie Meble', 'retail', [437244497]],
  ['IKEA Franowo', 'retail', [31767317]],
  ['Selgros', 'retail', [176242403]],
  ['Gigamarket', 'retail', [105143399]],
  ['Miasto Wnętrz', 'retail', [39350395]],
  ['Castorama', 'retail', [34157790]],
  ['M1 Poznań', 'retail', [31567787]],
  ['Galeria Pestka', 'retail', [121267696]],
  ['Makro', 'retail', [46994640]],
  ['Panorama', 'retail', [28196090]],
  ['Homepark Franowo', 'retail', [229139205]],
  ['OBI Franowo', 'retail', [161412082]],
  ['Hala M Franowo', 'retail', [40701475]],
  ['Decathlon Franowo', 'retail', [119909655]],
  ['Centrum Franowo', 'retail', [14194965]],
  ['Dworzec Poznań Główny', 'rail', [423143872]],
  ['Stary Dworzec Główny', 'rail', [6294130]],
  ['Dworzec Zachodni', 'rail', [260850132]],
  ['Dworzec Letni', 'rail', [263320508]],
  ['Poznań Wschód', 'rail', [380394260]],
  ['Poznań Garbary', 'rail', [680343992]],
  ['Poznań Górczyn', 'rail', [451352751]],
  ['Zajezdnia Głogowska', 'rail', [331761791]],
  ['Historyczna hala zajezdni', 'rail', [319194285]],
  ['Zajezdnia Madalińskiego', 'rail', [314752108]],
  ['ZNTK Robocza', 'industrial', [187916107, 188100057, 188099827]],
  ['Zajezdnia Franowo (hala postojowa)', 'rail', [411668410]],
  ['EC Garbary', 'industrial', [441964024, 81124883]],
  ['EC Karolin', 'industrial', [300835893]],
  ['Hale Główna (6.57 ha)', 'industrial', [110347208]],
  ['Hale Główna (4.46 ha)', 'industrial', [111841911]],
  ['Hale Główna (1.73 ha)', 'industrial', [165737905]],
  ['Warsztaty Główna (1.27 ha)', 'industrial', [417087405]],
  ['Antoninek hale (3.61 ha)', 'industrial', [358311425]],
  ['Enea Stadion', 'leisure', [8512283]],
  ['Hala Arena', 'leisure', [279682863]],
  ['Termy Maltańskie', 'leisure', [158699450]],
  ['Lodowisko Chwiałka', 'leisure', [183357024]],
  ['Lodowisko Malta', 'leisure', [188919088]],
  ['MTP (pawilony)', 'leisure', [38611562, 38611563, 38611564, 38611565, 429245997, 429245998, 430019596,
    430019597, 430019598, 40268434, 41847967, 41847968, 188337421, 188337422, 188337423, 40730708]],
  ['Politechnika Piotrowo', 'civic', [497154322, 497154324, 536004095, 300946610, 246290923, 1330185469]],
  ['AWF', 'civic', [30646033, 375344176, 301970539]],
  ['UAM Szamarzewo', 'civic', [19411116, 854186851, 9686094, 188337425]],
  ['UPP Wojska Polskiego', 'civic', [180397348, 225677389, 225677391, 1232461390, 6800187]],
  ['Szpital HCP', 'civic', [13224258]],
  ['Uniwersytecki Szpital Kliniczny', 'civic', [438294844]],
  ['Szpital Strusia', 'civic', [5336445]]
];
const allById = new Map(buildings.map((bd) => [bd.id, bd]));
function buildTargets() {
  return TARGETS.map(([label, cat, ids]) => {
    const parts = [];
    for (const id of ids) {
      const bd = allById.get(id);
      const t = tagsById.get(id);
      if (!bd || !t) { parts.push({ id, missingFromSnapshot: true }); continue; }
      const [x, z] = toWorldLL(...(lonLatById.get(id) || [GEO.frame.lon0, GEO.frame.lat0]));
      const bl = bd.label ? blockByLabel.get(bd.label) : null;
      const cv = coverage(id);
      parts.push({
        id, name: t.name || t['name:pl'] || '', kind: t.building || '', area: Math.round(bd.area), cells: bd.cells,
        blockId: bl ? bl.id : null, x: q(x), z: q(z), landmarkModel: landmarkModelAt(x, z, t.name || ''),
        coverage: cv && cv.inBox ? cv : null
      });
    }
    const present = parts.filter((p) => !p.missingFromSnapshot);
    const area = present.reduce((s, p) => s + p.area, 0);
    const cells = present.reduce((s, p) => s + p.cells, 0);
    const inBox = present.reduce((s, p) => s + (p.coverage ? p.coverage.inBox : 0), 0);
    const covered = present.reduce((s, p) => s + (p.coverage ? p.coverage.covered : 0), 0);
    const blockIds = [...new Set(present.map((p) => p.blockId).filter((id) => id !== null))];
    const blockRows = blockIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    return {
      label, cat, area, cells, inBox, covered, share: inBox ? covered / inBox : 0,
      blockIds, blocks: blockRows.map((r) => ({ id: r.id, district: r.district, area: r.area, program: r.program,
        built: r.realBuilt / r.area, generated: r.generated, generatedShare: r.generatedShare, maxHeight: r.maxHeight,
        lots: r.lots, park: r.park })),
      landmarkModels: [...new Set(present.map((p) => p.landmarkModel).filter(Boolean))],
      parts
    };
    });
}

// --- Per-block aggregate -------------------------------------------------------------------------------------------
const rows = [];
for (const bl of blocks) {
  const i = blockIndexById.get(bl.id);
  const cfg = config.BLOCKS[i];
  const stats = blockStats[i];
  const real = realByBlock.get(bl.id) || { retail: 0, rail: 0, industrial: 0, leisure: 0, civic: 0, office: 0 };
  const realNonres = Object.values(real).reduce((s, v) => s + v, 0);
  const generated = gen.get(bl.id) || 0;
  const realBuilt = Math.round(stats[0] * bl.area);
  rows.push({
    id: bl.id, label: bl.label, district: cfg ? cfg.district : null, area: bl.area, park: bl.park,
    program: stats[3], levels: stats[1], osmBuildings: stats[2], realBuilt,
    realNonres, realNonresShare: bl.area ? realNonres / bl.area : 0, real,
    generated: Math.round(generated), generatedShare: bl.area ? generated / bl.area : 0,
    generatedHasBuildings: !!anyByBlock.get(bl.id), maxHeight: Math.round(heightByBlock.get(bl.id) || 0),
    lots: bl.rects.length + (bl.frames || []).reduce((s, fr) => s + fr[3].length, 0),
    parkName: bl.parkName || '', x: q(cfg.cx), z: q(cfg.cz)
  });
}
const targets = buildTargets();

// Buildings outside every block (rail land, curbs, service lanes, outside the detail box)
const outside = records.filter((r) => r.blockId === null);
const outsideByName = new Map();
for (const r of outside) outsideByName.set(r.name || `#${r.id}`, r);

// --- Candidates ----------------------------------------------------------------------------------------------------
// a) block holds a real non-residential footprint of at least 1,500 m² and the simulation builds nothing there
const emptyBlocks = rows.filter((r) => r.realNonres >= 1500 && r.generated === 0)
  .sort((p, q2) => q2.realNonres - p.realNonres);
// b) big non-residential objects that landed in no block at all
const noBlock = records.filter((r) => r.blockId === null && r.cells >= 800)
  .sort((p, q2) => q2.cells - p.cells);
// c) blocks with large non-residential real area where the generated area is far below the real built area
const underBuilt = rows.filter((r) => r.realNonres >= 1500 && r.generated > 0 && r.generated < r.realBuilt * 0.35)
  .sort((p, q2) => q2.realNonres - p.realNonres);
// d) footprint clipped badly: the in-box raster cells cover less than half of the OSM outline
const clipped = records.filter((r) => r.area >= 1500 && r.cells > 0 && r.cells < r.area * 0.5)
  .sort((p, q2) => q2.area - p.area);
// e) footprints entirely missing from the raster (outside the detail box or no raster cell)
const noCells = records.filter((r) => r.area >= 1500 && r.cells === 0)
  .sort((p, q2) => q2.area - p.area);
// f) inside the detail box but no generated footprint of any kind stands over the real footprint (landmarks excluded:
//    their hand-built models are present)
const absent = records.filter((r) => !r.landmarkModel && r.area >= 800 && r.generated && r.generated.inBox > 0 &&
  r.generated.covered === 0).sort((p, q2) => q2.area - p.area);
// g) footprint partly covered (a mall replaced by a row of houses still "covers" cells; below half the outline)
const partial = records.filter((r) => !r.landmarkModel && r.area >= 800 && r.generated && r.generated.inBox > 0 &&
  r.generated.share > 0 && r.generated.share < 0.5).sort((p, q2) => q2.area - p.area);
// h) large non-residential footprints whose block gets generic buildings over the whole outline: the object is present
//    only as the wrong morphology (a hall as kamienice, a stadium as a slab)
const replaced = records.filter((r) => !r.landmarkModel && r.area >= 1500 && r.blockId !== null && r.generated &&
  r.generated.share >= 0.5).sort((p, q2) => q2.area - p.area);

const byCat = {};
for (const r of records) {
  const c2 = byCat[r.cat] || (byCat[r.cat] = { count: 0, area: 0, inBlock: 0, noBlock: 0, cells: 0,
    coveredCells: 0, absent: 0, absentArea: 0, landmarkModels: 0, outsideBox: 0, outsideBoxArea: 0 });
  c2.count++; c2.area += r.area; c2.cells += r.cells;
  if (r.blockId === null) c2.noBlock++; else c2.inBlock++;
  if (r.landmarkModel) c2.landmarkModels++;
  if (!r.generated || r.generated.inBox === 0) { c2.outsideBox++; c2.outsideBoxArea += r.area; continue; }
  c2.coveredCells += r.generated.covered || 0;
  if (!r.landmarkModel && r.generated.covered === 0) { c2.absent++; c2.absentArea += r.cells; }
}

const report = {
  generated: new Date().toISOString(),
  frame: { detailBox: GEO.frame.detailBox, ll: GEO.frame.ll },
  totals: {
    osmBuildings: buildings.length,
    nonresidential: totalNonres,
    nonresidentialArea: Math.round(totalNonresArea),
    blocks: blocks.length,
    generatedBlocks: city.allBlocks.length,
    emptyBlocks: emptyBlocks.length,
    emptyBlocksArea: Math.round(emptyBlocks.reduce((s, r) => s + r.realNonres, 0)),
    noBlockObjects: noBlock.length,
    clippedObjects: clipped.length,
    noCellsObjects: noCells.length,
    underBuiltBlocks: underBuilt.length,
    absentObjects: absent.length,
    partialObjects: partial.length,
    replacedObjects: replaced.length,
    records: records.length
  },
  byCategory: byCat,
  blockRows: rows,
  targets,
  emptyBlocks,
  noBlock,
  underBuilt,
  clipped,
  noCells,
  absent,
  partial,
  replaced,
  records,
  skippedRoof
};
writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);

// --- Console summary -----------------------------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
const fmt = (v) => (v >= 10000 ? `${(v / 10000).toFixed(2)} ha` : `${Math.round(v)} m²`);
console.log(`non-residential audit: ${OUT}`);
console.log(`OSM non-residential footprints: ${totalNonres} (${fmt(totalNonresArea)}), ${outside.length} outside any block`);
console.log(`blocks: ${emptyBlocks.length} empty with ≥ 1500 m² real non-residential, ${fmt(report.totals.emptyBlocksArea)} real area`);
console.log(`no-block objects ≥ 800 m²: ${noBlock.length}; clipped (< 50 % cells): ${clipped.length}; no raster cells: ${noCells.length}`);
console.log(`absent (in box, no generated footprint): ${absent.length}; partly covered: ${partial.length}; replaced whole: ${replaced.length}`);
for (const [k, v] of Object.entries(byCat)) {
  console.log(`  ${pad(k, 11)} ${pad(v.count, 4)} footprints ${pad(fmt(v.area), 10)} in ${pad(v.inBlock, 4)} blocks, ${v.noBlock} unassigned`);
}
console.log('\nTop empty blocks:');
for (const r of emptyBlocks.slice(0, 25)) {
  console.log(`  #${pad(r.id, 5)} ${pad(r.district, 30)} area ${pad(fmt(r.area), 9)} nonres ${pad(fmt(r.realNonres), 9)} real built ${pad((100 * r.realBuilt / r.area).toFixed(0) + '%', 4)} at ${r.x}, ${r.z}`);
}
console.log('\nTop no-block objects:');
for (const r of noBlock.slice(0, 20)) {
  console.log(`  ${pad(r.cat, 10)} ${pad(fmt(r.area), 9)} cells ${pad(r.cells, 5)} ${r.name || '#' + r.id} at ${r.x}, ${r.z}`);
}
console.log('\nTop clipped objects:');
for (const r of clipped.slice(0, 20)) {
  console.log(`  ${pad(r.cat, 10)} ${pad(fmt(r.area), 9)} cells ${pad(r.cells, 5)} block ${pad(r.blockId, 5)} ${r.name || '#' + r.id}`);
}
