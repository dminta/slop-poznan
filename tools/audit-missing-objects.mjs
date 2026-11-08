// tools/audit-missing-objects.mjs — audit of OSM buildings and structures that the simulation does not represent.
//
// usage: node --max-old-space-size=8192 tools/audit-missing-objects.mjs [out.json]
//
// The pipeline is the same one used by tools/build-poznan.mjs and tools/density-report.mjs:
// - tools/poz-blocks.mjs stamps the detail box into 1,418 curb islands and their lot rects/frontage frames,
// - tools/poz-buildings.mjs assigns each OSM footprint (building=*, plus the industry snapshot) to a block,
// - js/buildings.js is run headless and its generated footprints are rastered on a 2 m grid.
//
// A footprint is "present" when a hand-built landmark model covers it, a GEO.blockAnchors box stands on it, or at
// least half of its 2 m cells are under a generated footprint. Building=roof is counted separately: it is not built
// mass but it can be present as a GEO.canopies roof. Everything else is reported as omitted, with the pipeline stage
// that dropped it:
//
//   outside detail box   centroid outside GEO.frame.detailBox (snapshot is padded to 52.380-52.437 N)
//   no block             inside the box but the block raster has no label (road, rail corridor, water, plaza edge)
//   block without lots   the block has no lot rect (maskRects/fitRects left < 8 m, island under 300 m2)
//   median island        city-config marks the block as a tram median (< 9 m) and builds nothing on it
//   landmark reserve     a 36-name LANDMARK_RESERVE AABB+3 m keeps the generic generator out
//   park carve           parkFreeCells removed the cell (facility/ordinary park lots only partly restore it)
//   outside lots         block has lots, but this footprint falls in a gap (maskRects, minLot, splitDeep, roads)
//   in lots, unbuilt     footprint is inside effective lots but the profile left it empty (skipP, forecourt, ...)
//
// Output: JSON with summary, per-category and per-reason tables, the omitted records (>= 25 m2), named objects and
// curated known-Poznan targets. The console prints the same summary in a compact form.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');

const OUT = process.argv[2] || join(root, 'tools/audit-missing-objects.json');
const RAW = JSON.parse(readFileSync(join(root, 'tools/data/poz_buildings.json'), 'utf8'));
const INDUSTRY = JSON.parse(readFileSync(join(root, 'tools/data/poz_industry.json'), 'utf8'));
const config = await import(pathToFileURL(join(root, 'js/city-config.js')).href);
const { GEO } = await import(pathToFileURL(join(root, 'js/geodata.js')).href);
const { blocks } = await import(pathToFileURL(join(root, 'tools/poz-blocks.mjs')).href);
const { buildings } = await import(pathToFileURL(join(root, 'tools/poz-buildings.mjs')).href);
const { elemRings, scanRings, pointInRing } = await import(pathToFileURL(join(root, 'tools/geo-util.mjs')).href);
const { inDetailBox, toWorld, DETAIL_BOX } = await import(pathToFileURL(join(root, 'tools/poz-base.mjs')).href);
const { SATELLITE_SITES } = await import(pathToFileURL(join(root, 'js/satellite-sites.js')).href);

const q = (v) => Math.round(v * 10) / 10;
const pct = (v) => Math.round(v * 1000) / 1000;
const tagsById = new Map(RAW.elements.map((e) => [e.id, e.tags || {}]));
const elementById = new Map(RAW.elements.map((e) => [e.id, e]));
// poz-buildings adds cooling towers, chimneys, silos and tanks from the separate industry snapshot; their ids are not
// in poz_buildings.json. They are real built outlines too (EC Garbary, the wastewater works, Karolin's towers).
const industryTagsById = new Map(INDUSTRY.elements.map((e) => [e.id, e.tags || {}]));
const industryElementById = new Map(INDUSTRY.elements.map((e) => [e.id, e]));

// --- Classification -------------------------------------------------------------------------------------------------
// One group per omitted-object table. `building=yes` is resolved by the use tags first (a church, school or shop tagged
// only with building=yes would otherwise land in the residential long tail).
const RETAIL_KINDS = new Set(['retail', 'commercial', 'supermarket', 'department_store', 'wholesale', 'kiosk', 'stall',
  'shop', 'marketplace', 'hall']);
const INDUSTRIAL_KINDS = new Set(['industrial', 'warehouse', 'warehouses', 'factory', 'manufacture', 'hangar',
  'service', 'utility', 'water_tower', 'storage_tank', 'silo', 'greenhouse', 'barn', 'stable', 'digester', 'gasometer',
  'cooling_tower', 'slurry_tank', 'transformer_tower']);
const MILITARY_KINDS = new Set(['bunker', 'fort', 'blockhouse', 'battery', 'city_gate']);
const RAIL_KINDS = new Set(['train_station', 'transportation', 'station', 'railway_station', 'bus_station', 'engine_shed',
  'signal_box']);
const SPORT_KINDS = new Set(['stadium', 'sports_hall', 'sports_centre', 'arena', 'grandstand', 'ice_rink', 'riding_hall',
  'swimming_pool']);
const CIVIC_KINDS = new Set(['public', 'civic', 'government', 'townhall', 'library', 'museum', 'theatre', 'cinema',
  'exhibition_centre', 'community_centre', 'cultural_centre', 'fire_station', 'police', 'military', 'prison']);
const EDUCATION_KINDS = new Set(['school', 'kindergarten', 'university', 'college', 'dormitory']);
const HEALTH_KINDS = new Set(['hospital', 'clinic']);
const SACRAL_KINDS = new Set(['church', 'chapel', 'monastery', 'convent', 'presbytery', 'cathedral', 'mosque', 'synagogue',
  'shrine', 'wayside_shrine', 'religious']);
const GARAGE_KINDS = new Set(['garage', 'garages', 'carport']);
const OUTBUILDING_KINDS = new Set(['outbuilding', 'shed', 'hut', 'cabin', 'barn']);
const RESIDENTIAL_KINDS = new Set(['yes', 'apartments', 'house', 'residential', 'detached', 'semidetached_house',
  'terrace', 'bungalow', 'dormitory', 'hotel', 'houseboat', 'static_caravan']);
const NAME_EDUCATION = /szko[łl]a|szkola|liceum|technikum|przedszkol|gimnazjum|akademik|żłobek|zlobek|katedra i zakład/i;
const NAME_HEALTH = /szpital|klinik|przychodni|centrum medyczne|ambulator|sanatori|hospicjum/i;
const NAME_SACRAL = /kości[oó][łl]|kosciol|katedra|bazylika|kaplica|klasztor|zakon|sanktuarium|cerkiew/i;
const NAME_CIVIC = /urz[ąa]d|s[ąa]d|bibliotek|muzeum|teatr|kino|filharmoni|opera|centrum kultury|dom kultury|ratusz/i;
const NAME_LEISURE = /stadion|arena|hala sportow|hala widowisk|lodowisko|basen|p[łl]ywalni|plywalni|tor regat|korty|hipodrom|amfiteatr|term[y|y ]/i;
const NAME_RETAIL = /galeria|centrum handlowe|park handlowy|market|supermarket|hipermarket|castorama|makro|obi\b|ikea|selgros|decathlon|homepark|leroy|auchan|carrefour|tesco|kaufland|biedronka|lidl|netto|pawilon \d/i;
const NAME_RAIL = /dworzec|zajezdni|parowozownia|pkp|kolejow|zntk|bocznica|lokomotyw/i;
const NAME_INDUSTRIAL = /elektrociep[łl]owni|elektrocieplowni|zak[łl]ad|zaklad|hala (produkcyjna|zajezdni)|warsztat|hcp|cegielski|volkswagen|spalarni|oczyszczalni|magazyn|hurtowni|ch[łl]odni|chlodni|fabryk|kopalni|cukrowni/i;

function classify(t) {
  const kinds = String(t.building || '').toLowerCase().split(';').map((s) => s.trim()).filter(Boolean);
  const kind = kinds[0] || '';
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  if (kind === 'roof') return ['roof', kind];
  // Education and health first: a university church or "Katedra Inżynierii Biosystemów" is a campus building, not a
  // place of worship, and a clinic named "Szpital" must not fall into the residential long tail.
  if (EDUCATION_KINDS.has(kind) || t.amenity === 'school' || t.amenity === 'kindergarten' || t.amenity === 'university' ||
    t.amenity === 'college' || NAME_EDUCATION.test(name)) return ['education', kind];
  if (HEALTH_KINDS.has(kind) || t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare || NAME_HEALTH.test(name)) return ['health', kind];
  if (t.amenity === 'place_of_worship' || t.religion || SACRAL_KINDS.has(kind) ||
    (!kind && NAME_SACRAL.test(name))) return ['sacral', kind];
  if (MILITARY_KINDS.has(kind) || /fort\b|twierdz|bateri|\bschron\b/i.test(name)) return ['military', kind];
  if (RAIL_KINDS.has(kind) || t.railway || t.public_transport === 'station' || NAME_RAIL.test(name)) return ['rail', kind];
  if (SPORT_KINDS.has(kind) || SPORT_KINDS.has(t.leisure) || t.sport || t.leisure === 'water_park' || NAME_LEISURE.test(name)) return ['leisure', kind];
  if (CIVIC_KINDS.has(kind) || ['museum', 'theatre', 'cinema', 'library', 'townhall', 'public_building',
    'community_centre', 'arts_centre', 'exhibition_centre', 'conference_centre'].includes(t.amenity) ||
    t.tourism === 'museum' || NAME_CIVIC.test(name)) return ['civic', kind];
  if (RETAIL_KINDS.has(kind) || t.shop || t.amenity === 'marketplace' || NAME_RETAIL.test(name)) return ['retail', kind];
  if (INDUSTRIAL_KINDS.has(kind) || t.man_made === 'works' || t.man_made === 'cooling_tower' ||
    t.man_made === 'chimney' || t.man_made === 'silo' || t.man_made === 'storage_tank' ||
    t.power === 'plant' || t.power === 'substation' || t.landuse === 'industrial' || t.landuse === 'railway' ||
    NAME_INDUSTRIAL.test(name)) return ['industrial', kind || t.man_made || 'industry'];
  if (kind === 'ruins') return ['ruins', kind];
  if (kind === 'construction') return ['construction', kind];
  if (GARAGE_KINDS.has(kind)) return ['garage', kind];
  if (OUTBUILDING_KINDS.has(kind)) return ['outbuilding', kind];
  if (kind === 'office' || t.office) return ['office', kind];
  if (RESIDENTIAL_KINDS.has(kind) || !kind) return ['residential', kind || 'yes'];
  return ['other', kind];
}

// Name of a tile/point in the world frame (for report locations). GEO.landmarks holds 36 named sites.
function nearestLandmark(x, z) {
  let best = null, dist = Infinity;
  for (const [name, s] of Object.entries(GEO.landmarks)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < dist) { dist = d; best = name; }
  }
  return dist <= 120 ? { name: best, distance: Math.round(dist) } : null;
}

function landmarkModelAt(x, z, name) {
  for (const [lm, s] of Object.entries(GEO.landmarks)) {
    if (s.ring && s.ring.length >= 6 && pointInRing(x, z, flatRing(s.ring))) return lm;
    if (name && Math.hypot(s.x - x, s.z - z) <= Math.max(s.w, s.d) * 0.5 + 12 &&
      (name.includes(lm) || lm.includes(name))) return lm;
  }
  return null;
}
const flatRing = (ring) => {
  if (Array.isArray(ring[0])) return ring;
  const out = [];
  for (let i = 0; i + 1 < ring.length; i += 2) out.push([ring[i], ring[i + 1]]);
  return out;
};

// Point in an oriented rectangle { cx, cz, w, d, ang } (ang: long side, east from +x towards +z).
function inOrientedRect(x, z, cx, cz, w, d, ang, pad = 0) {
  const dx = x - cx, dz = z - cz;
  const c = Math.cos(ang), s = Math.sin(ang);
  const along = dx * c + dz * s;
  const across = -dx * s + dz * c;
  return Math.abs(along) <= w / 2 + pad && Math.abs(across) <= d / 2 + pad;
}

function satelliteAt(x, z, box = null) {
  for (const site of SATELLITE_SITES) {
    for (const p of site.parts) {
      if (inOrientedRect(x, z, p.x, p.z, p.w, p.d, (p.angle * Math.PI) / 180, 2)) return site.name;
      // A large L-plan is split into simplified rectangles; its OSM centroid can fall in a gap between them. Accept
      // the site when the footprint bbox and the part overlap at all.
      if (box) {
        const [x0, x1, z0, z1] = box;
        if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return site.name;
        for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
          if (inOrientedRect(cx, cz, p.x, p.z, p.w, p.d, (p.angle * Math.PI) / 180, 2)) return site.name;
        }
      }
    }
  }
  return null;
}
function canopyAt(x, z) {
  for (const c of GEO.canopies || []) {
    if (inOrientedRect(x, z, c.cx, c.cz, c.w, c.d, c.ang, 2)) return c.kind;
  }
  return null;
}

// --- Landmark reserve -----------------------------------------------------------------------------------------------
// Mirror of js/buildings.js LANDMARK_RESERVE: the 36 modelled sites plus SRODKA_MURAL, each outline grown by 3 m.
// The reserve is only used to name the reason; a footprint inside the actual landmark ring counts as present.
const RESERVE = [];
for (const [name, s] of Object.entries(GEO.landmarks)) {
  const ring = flatRing(s.ring || []);
  if (!ring.length) continue;
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  RESERVE.push({ name, x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, z0: Math.min(...zs) - 3, z1: Math.max(...zs) + 3 });
}
function reserveAt(x0, x1, z0, z1) {
  return RESERVE.find((r) => r.x0 < x1 && r.x1 > x0 && r.z0 < z1 && r.z1 > z0) || null;
}

// --- Block lot geometry ---------------------------------------------------------------------------------------------
const blockByLabel = new Map(blocks.map((b) => [b.label, b]));
const cfgById = new Map(config.BLOCKS.map((b) => [b.id, b]));
const cfgByLabel = new Map(blocks.map((b, i) => [b.label, config.BLOCKS[i]]));
const lotsByBlock = new Map();
for (const b of config.BLOCKS) {
  const lots = b.buildings && !b.median ? config.blockLots(b) : [];
  if (!lots.length) continue;
  let area = 0;
  for (const l of lots) area += (l.x1 - l.x0) * (l.z1 - l.z0);
  lotsByBlock.set(b.id, { lots, area });
}

// --- Generated city (headless js/buildings.js) ----------------------------------------------------------------------
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
const source = readFileSync(join(root, 'js/buildings.js'), 'utf8');
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
const RES = 2;
const RW = Math.ceil((B.maxX - B.minX) / RES);
const RH = Math.ceil((B.maxZ - B.minZ) / RES);
const cellArea = RES * RES;
const grid = { x0: B.minX, z0: B.minZ, res: RES, w: RW, h: RH };

const generated = new Uint8Array(RW * RH);
const generatedH = new Float32Array(RW * RH);
const inQuad = (pts, x, z) => {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i], n = pts[(i + 1) % 4];
    const c = (n.x - p.x) * (z - p.z) - (n.z - p.z) * (x - p.x);
    if (c > 0) s |= 1;
    else if (c < 0) s |= 2;
  }
  return s !== 3;
};
for (const blk of city.allBlocks) {
  for (const fp of blk.footprints) {
    const i0 = Math.max(0, Math.floor((fp.x0 - B.minX) / RES));
    const i1 = Math.min(RW - 1, Math.floor((fp.x1 - B.minX) / RES));
    const j0 = Math.max(0, Math.floor((fp.z0 - B.minZ) / RES));
    const j1 = Math.min(RH - 1, Math.floor((fp.z1 - B.minZ) / RES));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = B.minX + (i + 0.5) * RES, z = B.minZ + (j + 0.5) * RES;
        if (fp.pts && !inQuad(fp.pts, x, z)) continue;
        const k = j * RW + i;
        generated[k] = 1;
        if ((fp.h || 0) > generatedH[k]) generatedH[k] = fp.h || 0;
      }
    }
  }
}

// Effective lots, rastered on the same 2 m grid. A footprint outside every lot has no parcel for the generator at all.
const lotMask = new Uint8Array(RW * RH);
for (const { lots } of lotsByBlock.values()) {
  for (const l of lots) {
    const corners = [[-l.hx, -l.hz], [l.hx, -l.hz], [l.hx, l.hz], [-l.hx, l.hz]].map(([u, v]) => [
      l.cx + u * l.cs + v * l.sn, l.cz - u * l.sn + v * l.cs
    ]);
    const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - B.minX) / RES));
    const i1 = Math.min(RW - 1, Math.floor((Math.max(...xs) - B.minX) / RES));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - B.minZ) / RES));
    const j1 = Math.min(RH - 1, Math.floor((Math.max(...zs) - B.minZ) / RES));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = B.minX + (i + 0.5) * RES, z = B.minZ + (j + 0.5) * RES;
        const ox = x - l.cx, oz = z - l.cz;
        const lx = ox * l.cs - oz * l.sn;
        const lz = ox * l.sn + oz * l.cs;
        if (Math.abs(lx) <= l.hx + 1e-6 && Math.abs(lz) <= l.hz + 1e-6) lotMask[j * RW + i] = 1;
      }
    }
  }
}

// Raw lot rects (before parkFreeCells/splitDeep/minLot), rastered on the same grid. A footprint outside the effective
// lots but inside a raw rect was lost to splitDeep, minLot or a park carve; one outside both was lost earlier, to
// maskRects/frontage-frame coverage of the property line.
const rawMask = new Uint8Array(RW * RH);
let rawParcelArea = 0;
for (const b of config.BLOCKS) {
  for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
    const cs = Math.cos(th), sn = Math.sin(th);
    for (const [x0, x1, z0, z1] of rects) {
      rawParcelArea += (x1 - x0) * (z1 - z0);
      const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([lx, lz]) => [
        px + (lx - px) * cs + (lz - pz) * sn, pz - (lx - px) * sn + (lz - pz) * cs
      ]);
      const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - B.minX) / RES));
      const i1 = Math.min(RW - 1, Math.floor((Math.max(...xs) - B.minX) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - B.minZ) / RES));
      const j1 = Math.min(RH - 1, Math.floor((Math.max(...zs) - B.minZ) / RES));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = B.minX + (i + 0.5) * RES, z = B.minZ + (j + 0.5) * RES;
          const lx = px + (x - px) * cs - (z - pz) * sn;
          const lz = pz + (x - px) * sn + (z - pz) * cs;
          if (lx >= x0 && lx <= x1 && lz >= z0 && lz <= z1) rawMask[j * RW + i] = 1;
        }
      }
    }
  }
}

// Park land, rastered from the same GEO.parks rings city-config uses. Only used to label the reason.
const parkMask = new Uint8Array(RW * RH);
for (const p of config.PARK_RINGS) {
  const ring = flatRing(p.r);
  const xs = ring.map((v) => v[0]), zs = ring.map((v) => v[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - B.minX) / RES));
  const i1 = Math.min(RW - 1, Math.floor((Math.max(...xs) - B.minX) / RES));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - B.minZ) / RES));
  const j1 = Math.min(RH - 1, Math.floor((Math.max(...zs) - B.minZ) / RES));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (pointInRing(B.minX + (i + 0.5) * RES, B.minZ + (j + 0.5) * RES, ring)) parkMask[j * RW + i] = 1;
    }
  }
}

// --- Per-footprint measurement --------------------------------------------------------------------------------------
function footprintStats(el, outer, inner) {
  let cells = 0, covered = 0, lot = 0, raw = 0, park = 0, hsum = 0, hmax = 0;
  scanRings(inner.length ? outer.concat(inner) : outer, grid, (i, j) => {
    const k = j * RW + i;
    cells++;
    if (generated[k]) { covered++; hsum += generatedH[k]; if (generatedH[k] > hmax) hmax = generatedH[k]; }
    if (lotMask[k]) lot++;
    if (rawMask[k]) raw++;
    if (parkMask[k]) park++;
  });
  return {
    cells, covered, lot, raw, park,
    share: cells ? covered / cells : 0,
    lotShare: cells ? lot / cells : 0,
    rawShare: cells ? raw / cells : 0,
    parkShare: cells ? park / cells : 0,
    hmax: Math.round(hmax * 10) / 10,
    hmean: covered ? Math.round((hsum / covered) * 10) / 10 : 0
  };
}

function blockAnchorAt(bd) {
  const box = bd.inBoxBox;
  if (!box || !bd.label) return null;
  const cfg = cfgByLabel.get(bd.label);
  if (!cfg || !cfg.anchors) return null;
  const cx = (box[0] + box[1]) / 2, cz = (box[2] + box[3]) / 2;
  for (const a of cfg.anchors) {
    if (cx >= a[0] && cx <= a[1] && cz >= a[2] && cz <= a[3]) return a;
  }
  return null;
}

// Every building=* element (roof and no included) whose centroid is in the detail box, for the raw count.
let rawBuildingInBox = 0, rawBuildingOutsideBox = 0;
for (const el of RAW.elements) {
  if (!el.tags || !el.tags.building) continue;
  let x = 0, z = 0, n = 0;
  for (const g of el.geometry || []) { const p = toWorld(g.lon, g.lat); x += p[0]; z += p[1]; n++; }
  for (const m of el.members || []) for (const g of m.geometry || []) {
    const p = toWorld(g.lon, g.lat);
    x += p[0]; z += p[1]; n++;
  }
  if (!n) continue;
  if (inDetailBox(x / n, z / n, 0)) rawBuildingInBox++; else rawBuildingOutsideBox++;
}

const records = [];
const byCategory = new Map();
const byReason = new Map();
const byKind = new Map();
let totalCells = 0, totalCovered = 0, totalLot = 0, totalPark = 0;
let presentLandmark = 0, presentAnchor = 0, presentGenerated = 0, presentSatellite = 0;
let inBox = 0, outOfBox = 0, noBlock = 0, omittedCount = 0, omittedArea = 0;

for (const bd of buildings) {
  const t = tagsById.get(bd.id) || industryTagsById.get(bd.id) || {};
  const el = elementById.get(bd.id) || industryElementById.get(bd.id);
  if (!el) continue;
  const [category, kind] = classify(t);
  const name = t.name || t['name:pl'] || '';
  const box = inDetailBox(bd.cx, bd.cz, 0);
  if (box) inBox++; else outOfBox++;
  const bl = bd.label ? blockByLabel.get(bd.label) : null;
  const cfg = bl ? cfgById.get(bl.id) : null;
  if (box && !bl) noBlock++;
  const outer = elemRings(el, toWorld).filter((r) => r.length > 3);
  if (!outer.length) continue;
  const inner = elemRings(el, toWorld, 'inner').filter((r) => r.length > 3);
  const st = footprintStats(el, outer, inner);
  if (box) {
    totalCells += st.cells;
    totalCovered += st.covered;
    totalLot += st.lot;
    totalPark += st.park;
  }
  const landmark = landmarkModelAt(bd.cx, bd.cz, name);
  const anchor = blockAnchorAt(bd);
  const satellite = !box ? satelliteAt(bd.cx, bd.cz, bd.bbox) : null;
  let presence = 'missing';
  if (landmark) { presence = 'landmark'; presentLandmark++; }
  else if (anchor) { presence = 'anchor'; presentAnchor++; }
  else if (satellite) { presence = 'satellite'; presentSatellite++; }
  else if (st.share >= 0.5) { presence = 'generated'; presentGenerated++; }

  let reason = null;
  if (presence === 'missing') {
    omittedCount++;
    omittedArea += bd.area;
    if (!box) reason = 'outside detail box (outskirts)';
    else if (!bl) reason = 'no block (road/rail/water edge)';
    else if (cfg && cfg.median) reason = 'median island';
    else if (!lotsByBlock.has(bl.id)) {
      reason = st.rawShare >= 0.5 ? 'block lots lost (minLot)' : 'block without lots (maskRects)';
    } else if (reserveAt(bd.bbox[0], bd.bbox[1], bd.bbox[2], bd.bbox[3]) && !landmark) {
      reason = 'landmark reserve';
    } else if (st.lotShare < 0.5) {
      if (st.parkShare >= 0.5) reason = 'park carve';
      else if (st.rawShare >= 0.5) reason = 'splitDeep/minLot gap';
      else reason = 'property-line gap (maskRects/frames)';
    } else reason = 'in lots, unbuilt';
  }

  const rec = {
    id: bd.id, name, kind, category, levels: bd.levels || 0, area: Math.round(bd.area), cells: bd.cells,
    blockId: bl ? bl.id : null, district: cfg ? cfg.district : null, park: cfg ? cfg.park : 0,
    x: q(bd.cx), z: q(bd.cz), inBox: box, presence, reason,
    coverage: pct(st.share), lotShare: pct(st.lotShare), rawShare: pct(st.rawShare), parkShare: pct(st.parkShare),
    height: st.hmax, landmark: landmark || null, anchorUse: anchor ? anchor[5] : 0,
    reserve: reserveAt(bd.bbox[0], bd.bbox[1], bd.bbox[2], bd.bbox[3])?.name || null,
    satellite: satellite || null, nearest: nearestLandmark(bd.cx, bd.cz)
  };
  records.push(rec);
  if (presence === 'missing') {
    const cat = byCategory.get(category) || { category, total: 0, totalArea: 0, omitted: 0, area: 0, named: 0,
      inBox: 0, inBoxArea: 0, structural: 0, structuralArea: 0, profile: 0, profileArea: 0 };
    cat.omitted++;
    cat.area += bd.area;
    if (name) cat.named++;
    if (box) {
      cat.inBox++;
      cat.inBoxArea += bd.area;
      if (reason === 'in lots, unbuilt') { cat.profile++; cat.profileArea += bd.area; }
      else { cat.structural++; cat.structuralArea += bd.area; }
    }
    byCategory.set(category, cat);
    const rs = byReason.get(reason) || { reason, count: 0, area: 0, categories: {} };
    rs.count++;
    rs.area += bd.area;
    rs.categories[category] = (rs.categories[category] || 0) + 1;
    byReason.set(reason, rs);
    const kk = byKind.get(kind) || { kind, count: 0, area: 0 };
    kk.count++;
    kk.area += bd.area;
    byKind.set(kind, kk);
  }
  const cat = byCategory.get(category) || { category, total: 0, totalArea: 0, omitted: 0, area: 0, named: 0,
    inBox: 0, inBoxArea: 0, structural: 0, structuralArea: 0, profile: 0, profileArea: 0 };
  cat.total++;
  cat.totalArea += bd.area;
  byCategory.set(category, cat);
}

// --- building=roof: not built mass, but canopies ---------------------------------------------------------------------
const roofs = [];
let roofInBox = 0, roofAreaInBox = 0, roofWithCanopy = 0, roofCanopyArea = 0;
for (const el of RAW.elements) {
  const t = el.tags || {};
  if (String(t.building || '').toLowerCase() !== 'roof') continue;
  const outer = elemRings(el, toWorld).filter((r) => r.length > 3);
  if (!outer.length) continue;
  const inner = elemRings(el, toWorld, 'inner').filter((r) => r.length > 3);
  let x = 0, z = 0, n = 0, area = 0;
  for (const r of outer) {
    for (const p of r) { x += p[0]; z += p[1]; n++; }
    area += Math.abs(r.reduce((sum, p, i) => {
      const a = r[(i + r.length - 1) % r.length];
      return sum + a[0] * p[1] - p[0] * a[1];
    }, 0)) / 2;
  }
  x /= n; z /= n;
  const box = inDetailBox(x, z, 0);
  if (box) { roofInBox++; roofAreaInBox += area; }
  const canopy = box ? canopyAt(x, z) : null;
  if (canopy) { roofWithCanopy++; roofCanopyArea += area; }
  if (area >= 60) roofs.push({ id: el.id, area: Math.round(area), x: q(x), z: q(z), inBox: box, canopy,
    name: t.name || t['name:pl'] || '' });
}

// --- Tables ---------------------------------------------------------------------------------------------------------
const catRows = [...byCategory.values()].sort((a, b) => b.area - a.area).map((c) => ({
  category: c.category, total: c.total, totalArea: Math.round(c.totalArea),
  omitted: c.omitted, omittedShare: c.total ? pct(c.omitted / c.total) : 0,
  area: Math.round(c.area), named: c.named,
  inBox: c.inBox || 0, inBoxArea: Math.round(c.inBoxArea || 0),
  structural: c.structural || 0, structuralArea: Math.round(c.structuralArea || 0),
  profile: c.profile || 0, profileArea: Math.round(c.profileArea || 0)
}));
const reasonRows = [...byReason.values()].sort((a, b) => b.area - a.area).map((r) => ({
  reason: r.reason, count: r.count, area: Math.round(r.area),
  categories: Object.entries(r.categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(', ')
}));
const kindAll = new Map();
for (const r of records) {
  const k = kindAll.get(r.kind) || { kind: r.kind, total: 0, totalArea: 0, omitted: 0, area: 0 };
  k.total++;
  k.totalArea += r.area;
  if (r.presence === 'missing') { k.omitted++; k.area += r.area; }
  kindAll.set(r.kind, k);
}
const kindRows = [...kindAll.values()].sort((a, b) => b.area - a.area).map((k) => ({
  kind: k.kind, total: k.total, omitted: k.omitted, omittedShare: k.total ? pct(k.omitted / k.total) : 0,
  area: Math.round(k.area)
}));

const omitted = records.filter((r) => r.presence === 'missing');
const structural = omitted.filter((r) => r.inBox && r.reason !== 'in lots, unbuilt');
const profile = omitted.filter((r) => r.reason === 'in lots, unbuilt');
const extent = omitted.filter((r) => !r.inBox);
const topOmitted = [...omitted].sort((a, b) => b.area - a.area).slice(0, 120).map((r) => ({
  id: r.id, name: r.name, kind: r.kind, category: r.category, area: r.area, blockId: r.blockId,
  district: r.district, x: r.x, z: r.z, reason: r.reason, coverage: r.coverage, lotShare: r.lotShare,
  rawShare: r.rawShare, nearest: r.nearest
}));
const namedOmitted = omitted.filter((r) => r.name && r.area >= 200)
  .sort((a, b) => b.area - a.area)
  .map((r) => ({ id: r.id, name: r.name, kind: r.kind, category: r.category, area: r.area, blockId: r.blockId,
    district: r.district, x: r.x, z: r.z, reason: r.reason, coverage: r.coverage, lotShare: r.lotShare,
    rawShare: r.rawShare, landmark: r.landmark, reserve: r.reserve }));

const recordsByBlock = new Map();
for (const r of records) {
  if (!r.inBox || r.blockId === null) continue;
  const list = recordsByBlock.get(r.blockId) || [];
  list.push(r);
  recordsByBlock.set(r.blockId, list);
}
const blockSummary = [];
for (const b of blocks) {
  const cfg = cfgById.get(b.id);
  const lot = lotsByBlock.get(b.id);
  const list = recordsByBlock.get(b.id) || [];
  if (!list.length && !lot) continue;
  const cells = list.reduce((s, r) => s + r.cells, 0);
  let omitted = 0, omittedArea = 0, structuralArea = 0, profileArea = 0;
  for (const r of list) {
    if (r.presence !== 'missing') continue;
    omitted++;
    omittedArea += r.area;
    if (r.reason === 'in lots, unbuilt') profileArea += r.area;
    else structuralArea += r.area;
  }
  blockSummary.push({
    id: b.id, district: cfg ? cfg.district : null, area: b.area, park: cfg ? cfg.park : 0,
    parkName: cfg ? cfg.parkName : '', program: cfg ? cfg.program : 0,
    buildings: list.length, osmCells: cells, lots: lot ? lot.lots.length : 0,
    lotArea: lot ? Math.round(lot.area) : 0,
    lotCountOverBlock: b.area ? pct((lot ? lot.area : 0) / b.area) : 0,
    omitted, omittedArea: Math.round(omittedArea),
    structuralArea: Math.round(structuralArea), profileArea: Math.round(profileArea)
  });
}

// --- Curated known Poznan objects -----------------------------------------------------------------------------------
// Every named omitted object from the branches a player notices from the street. The full list is in the JSON; the
// console prints the 12 largest per category.
const blockPick = (key) => [...blockSummary].filter((b) => b[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 25)
  .map((b) => ({ id: b.id, district: b.district, area: b.area, park: b.park, program: b.program, buildings: b.buildings,
    lots: b.lots, lotArea: b.lotArea, omitted: b.omitted, omittedArea: b.omittedArea,
    structuralArea: b.structuralArea, profileArea: b.profileArea }));
const topBlocks = { structural: blockPick('structuralArea'), profile: blockPick('profileArea'), omitted: blockPick('omittedArea') };

// Blocks with no blockStats programme but a real non-residential object the district profile cannot represent
// (school, church, clinic, shop, hall). These are the cheapest candidates for additional programmes or anchors.
const PROGRAM_CATEGORIES = new Set(['education', 'health', 'sacral', 'retail', 'industrial', 'civic', 'leisure', 'rail']);
const missedPrograms = [];
for (const [id, list] of recordsByBlock) {
  const cfg = cfgById.get(id);
  if (!cfg || cfg.program) continue;
  const byCat = {};
  let total = 0;
  for (const r of list) {
    if (r.presence !== 'missing' || !PROGRAM_CATEGORIES.has(r.category) || r.area < 150) continue;
    byCat[r.category] = (byCat[r.category] || 0) + r.area;
    total += r.area;
  }
  if (total < 500) continue;
  missedPrograms.push({
    id, district: cfg.district, area: cfg.area, park: cfg.park, buildings: list.length,
    lots: blockSummary.find((b) => b.id === id)?.lots || 0, missingNonRes: Math.round(total),
    categories: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${Math.round(v)}`).join(', ')
  });
}
missedPrograms.sort((a, b) => b.missingNonRes - a.missingNonRes);

// Big objects the earlier audits and fixes already handle (anchors, landmarks, satellites). Reported to separate
// "still missing" from "already present", so a recommendation does not reopen a closed item.
const CURATED = [
  ['CH Posnania', 390832753], ['CH Avenida', 368791550], ['Stary Browar', 181129696], ['Kupiec Poznański', 35277661],
  ['Galeria MM', 427983275], ['IKEA Franowo', 31767317], ['Selgros', 176242403], ['Castorama', 34157790],
  ['M1 Poznań', 31567787], ['Enea Stadion', 8512283], ['Hala Arena', 279682863], ['Termy Maltańskie', 158699450],
  ['EC Garbary (turbine hall)', 81124883], ['Zajezdnia Głogowska', 331761791], ['MTP Pawilon 5', 38611564],
  ['MTP Pawilon 6', 188337421], ['MTP Pawilon 8', 430019598], ['MTP Pawilon 12', 40268434],
  ['Szpital HCP', 13224258], ['Uniwersytecki Szpital Kliniczny', 438294844], ['Poznań Główny', 423143872]
];
const recordById = new Map(records.map((r) => [r.id, r]));
const curated = CURATED.map(([name, id]) => {
  const r = recordById.get(id);
  return r ? { name, id, presence: r.presence, reason: r.reason, area: r.area, blockId: r.blockId,
    coverage: r.coverage, lotShare: r.lotShare, landmark: r.landmark, satellite: r.satellite } : { name, id, missingFromSnapshot: true };
});

const KNOWN = ['sacral', 'education', 'health', 'civic', 'leisure', 'retail', 'rail', 'industrial', 'military'];
const known = {};
for (const cat of KNOWN) known[cat] = namedOmitted.filter((r) => r.category === cat).slice(0, 25);

const bigRoofsInBox = roofs.filter((r) => r.inBox);
const zeroLot = omitted.filter((r) => r.inBox && r.lotShare === 0);
const zeroCoverage = omitted.filter((r) => r.inBox && r.coverage === 0);
const zeroCoverageCategories = {};
for (const r of zeroCoverage) {
  const z = zeroCoverageCategories[r.category] || { category: r.category, count: 0, area: 0 };
  z.count++;
  z.area += r.area;
  zeroCoverageCategories[r.category] = z;
}
const summary = {
  frame: { detailBox: DETAIL_BOX.map((v) => Math.round(v)), dataBoxLatLon: [52.380, 52.437, 16.875, 17.005] },
  raw: {
    elements: RAW.elements.length,
    buildingElements: RAW.elements.filter((e) => e.tags && e.tags.building).length,
    countedFootprints: buildings.length,
    roofElements: RAW.elements.filter((e) => String(e.tags?.building || '').toLowerCase() === 'roof').length,
    buildingNo: RAW.elements.filter((e) => String(e.tags?.building || '').toLowerCase() === 'no').length,
    buildingInBox: rawBuildingInBox, buildingOutsideBox: rawBuildingOutsideBox,
    countedInBox: inBox, countedOutsideBox: outOfBox,
    industryElements: INDUSTRY.elements.length,
    industryFootprints: buildings.filter((bd) => !elementById.has(bd.id)).length
  },
  present: {
    landmark: presentLandmark, anchor: presentAnchor, generated: presentGenerated,
    satellite: presentSatellite, omitted: omittedCount
  },
  omitted: { count: omittedCount, area: Math.round(omittedArea), inBox: omitted.filter((r) => r.inBox).length },
  omittedTiers: {
    structural: { count: structural.length, area: Math.round(structural.reduce((s, r) => s + r.area, 0)) },
    profile: { count: profile.length, area: Math.round(profile.reduce((s, r) => s + r.area, 0)) },
    extent: { count: extent.length, area: Math.round(extent.reduce((s, r) => s + r.area, 0)) },
    zeroLot: { count: zeroLot.length, area: Math.round(zeroLot.reduce((s, r) => s + r.area, 0)) },
    zeroCoverage: { count: zeroCoverage.length, area: Math.round(zeroCoverage.reduce((s, r) => s + r.area, 0)),
      categories: Object.values(zeroCoverageCategories).sort((a, b) => b.area - a.area)
        .map((z) => ({ category: z.category, count: z.count, area: Math.round(z.area) })) }
  },
  osmFootprint: {
    cells: totalCells, cellArea: totalCells * cellArea,
    coveredShare: totalCells ? pct(totalCovered / totalCells) : 0,
    lotShare: totalCells ? pct(totalLot / totalCells) : 0,
    parkShare: totalCells ? pct(totalPark / totalCells) : 0,
    lotCells: totalLot, parkCells: totalPark,
    inBoxArea: Math.round(totalCells * cellArea), lotAreaOnFootprints: Math.round(totalLot * cellArea),
    parkAreaOnFootprints: Math.round(totalPark * cellArea)
  },
  blocks: {
    total: blocks.length,
    labelledFootprints: records.filter((r) => r.inBox && r.blockId !== null).length,
    unlabelledFootprints: records.filter((r) => r.inBox && r.blockId === null).length,
    withLots: [...lotsByBlock.keys()].length,
    withoutLots: blocks.length - [...lotsByBlock.keys()].length,
    withoutRawRects: config.BLOCKS.filter((b) => !b.rects.length).length,
    median: config.BLOCKS.filter((b) => b.median).length,
    medianWithBuildings: blockSummary.filter((b) => cfgById.get(b.id)?.median && b.buildings).length,
    parcels: [...lotsByBlock.values()].reduce((s, v) => s + v.lots.length, 0),
    parcelArea: Math.round([...lotsByBlock.values()].reduce((s, v) => s + v.area, 0)),
    rawParcelArea: Math.round(rawParcelArea),
    programs: config.BLOCKS.reduce((m, b) => { m[b.program] = (m[b.program] || 0) + 1; return m; }, {}),
    parkBlocks: config.BLOCKS.filter((b) => b.park > 0).length,
    mostlyParkBlocks: config.BLOCKS.filter((b) => b.park > 0.6).length
  },
  roofs: { inBox: roofInBox, areaInBox: Math.round(roofAreaInBox), withCanopy: roofWithCanopy,
    canopyArea: Math.round(roofCanopyArea), canopiesInGeo: (GEO.canopies || []).length,
    bigInBox: bigRoofsInBox.length, bigWithCanopy: bigRoofsInBox.filter((r) => r.canopy).length,
    bigWithoutCanopy: bigRoofsInBox.filter((r) => !r.canopy).length,
    bigAreaWithoutCanopy: Math.round(bigRoofsInBox.filter((r) => !r.canopy).reduce((s, r) => s + r.area, 0)) },
  categories: catRows,
  reasons: reasonRows,
  kinds: kindRows,
  topOmitted,
  namedOmitted,
  known,
  curated,
  topBlocks,
  missedPrograms: missedPrograms.slice(0, 60),
  missedProgramCount: missedPrograms.length,
  blockSummary
};

writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(`missing-objects audit -> ${OUT}`);
console.log(`OSM building elements ${summary.raw.buildingElements}, counted footprints ${buildings.length}, in detail box ${inBox}, outside ${outOfBox}`);
console.log(`present: landmark ${presentLandmark}, anchor ${presentAnchor}, generated ${presentGenerated}, satellite ${presentSatellite}; omitted ${omittedCount} (${(omittedArea / 1e4).toFixed(1)} ha)`);
console.log(`omitted tiers: structural ${summary.omittedTiers.structural.count} (${(summary.omittedTiers.structural.area / 1e4).toFixed(1)} ha), profile ${summary.omittedTiers.profile.count} (${(summary.omittedTiers.profile.area / 1e4).toFixed(1)} ha), outside box ${summary.omittedTiers.extent.count} (${(summary.omittedTiers.extent.area / 1e4).toFixed(1)} ha)`);
console.log(`no lot at all: ${summary.omittedTiers.zeroLot.count} (${(summary.omittedTiers.zeroLot.area / 1e4).toFixed(1)} ha); no generated coverage: ${summary.omittedTiers.zeroCoverage.count} (${(summary.omittedTiers.zeroCoverage.area / 1e4).toFixed(1)} ha)`);
console.log(`footprints in box: ${(totalCells * cellArea / 1e4).toFixed(1)} ha, generated ${(summary.osmFootprint.coveredShare * 100).toFixed(1)} %, inside effective lots ${(summary.osmFootprint.lotShare * 100).toFixed(1)} %, park ${(summary.osmFootprint.parkShare * 100).toFixed(1)} %`);
console.log(`blocks ${blocks.length}: ${summary.blocks.withLots} with lots, ${summary.blocks.withoutLots} without, ${summary.blocks.parcels} parcels (${(summary.blocks.parcelArea / 1e4).toFixed(0)} ha), ${summary.blocks.medianWithBuildings} median islands with buildings`);
console.log(`roofs in box: ${roofInBox} (${(roofAreaInBox / 1e4).toFixed(1)} ha), with canopy ${roofWithCanopy} (${(roofCanopyArea / 1e4).toFixed(1)} ha)`);
console.log(`blocks with no programme but >= 500 m2 of omitted non-residential use: ${missedPrograms.length}`);
console.log('\ncategory            total  omitted  omitted%  omitted ha  in-box ha  structural ha  profile ha');
for (const c of catRows) console.log(`${c.category.padEnd(20)}${String(c.total).padStart(6)}${String(c.omitted).padStart(9)}${(c.omittedShare * 100).toFixed(1).padStart(10)}${(c.area / 1e4).toFixed(1).padStart(11)}${(c.inBoxArea / 1e4).toFixed(1).padStart(11)}${(c.structuralArea / 1e4).toFixed(1).padStart(14)}${(c.profileArea / 1e4).toFixed(1).padStart(12)}`);
console.log('\nreason                         count   area ha');
for (const r of reasonRows) console.log(`${r.reason.padEnd(31)}${String(r.count).padStart(6)}${(r.area / 1e4).toFixed(1).padStart(10)}`);
console.log('\ntop omitted kinds');
for (const k of kindRows.slice(0, 20)) console.log(`${k.kind.padEnd(20)}${String(k.total).padStart(6)}${String(k.omitted).padStart(9)}${(k.omittedShare * 100).toFixed(1).padStart(10)}${(k.area / 1e4).toFixed(1).padStart(9)} ha`);
