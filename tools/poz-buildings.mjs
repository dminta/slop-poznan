// tools/poz-buildings.mjs — real building density per block for tools/build-poznan.mjs (docs/poznan-plan.md Phase 14):
// the OSM building footprints (poz_buildings.json) rasterised on the poz-blocks.mjs 1 m block raster. Work happens at
// import time. The footprints themselves are not emitted (several MB); only the per-block stats are.
//
// - Footprints: every building way, and every building multipolygon relation as its chained outer rings minus its
//   chained inner rings (even-odd). A way that is also the outer member of a building relation is skipped, so a
//   building tagged on both is counted once.
// - building=roof (555 elements on the 2026-10-27 snapshot: petrol-station and platform canopies, market roofs) and
//   building=no are left out: they have no walls, so they are not the built mass the runtime fills a block with.
//   building=construction (60) is kept: a site under construction (AND2) is a built lot, not an empty one.
// - Each building belongs to the block under its area centroid; when that falls off every block (on a sidewalk cut, a
//   service lane or outside the box), to the block holding most of its cells.
//
// Exports: blockStats [[built share, median levels, buildings, program], ...] aligned with poz-blocks `blocks` (program
// 0 none, 1 hospital/clinic campus, 2 university campus, from building tags and names); blockFootprints ({ block id:
// [[x0, x1, z0, z1, area], ...] }) for park blocks only, the axis-aligned envelopes of their mapped sport/show/public
// facilities of at least PARK_BUILDING_MIN area (buildings.js keeps those park cells as lots, so a stadium or arena is
// not cleared to lawn); blockAnchors ({ block id: [[x0, x1, z0, z1, area, use, levels], ...] }), the 1-3 largest
// mapped non-residential footprints of each block (use 1 retail, 2 industrial, 3 rail/depot, 4 sport/leisure,
// 5 utility), with their in-block raster envelope and OSM storeys. buildings.js puts one dedicated building on each
// anchor and leaves the rest of the block as service yard or low auxiliary pavilions;
// buildingMask (Uint8Array over blockRaster, 1 = under a counted footprint); buildings [{ id, levels, use, cells, cx,
// cz, label, anchorUse }].
import { load, log, toWorld } from './poz-base.mjs';
import { elemRings, ringArea, scanRings } from './geo-util.mjs';
import { blocks, blockRaster as R, blockLabels as lab } from './poz-blocks.mjs';

const T0 = Date.now();
const osm = load('poz_buildings.json');
const SKIP = new Set(['roof', 'no']);
const relOuter = new Set();
for (const e of osm.elements) {
  if (e.type !== 'relation') continue;
  for (const m of e.members || []) if (m.type === 'way' && m.role === 'outer') relOuter.add(m.ref);
}

// "3", "4.5", "3;5" (the higher part wins) or junk; storeys above ground as a positive number, else 0
const parseLevels = (v) => {
  if (!v) return 0;
  const n = Math.max(...String(v).split(/[;,-]/).map((s) => parseFloat(s)).filter((x) => x > 0 && x < 100));
  return Number.isFinite(n) ? n : 0;
};

// Building use for the campus profile: 1 hospital/clinic, 2 university/college, 0 other. OSM tags the large hospital
// campuses either as building=hospital or by name (Szpital, Klinika, Collegium); a block with a single hospital
// building still counts when it is a large, sparsely built campus (see the program threshold below)
const HOSPITAL_NAME = /szpital|klinik|przychodni|centrum medyczne|ambulator|sanatori/i;
const UNIVERSITY_NAME = /collegium|uniwers|uczel|akadem|politechnik|instytut/i;
const buildingUse = (t) => {
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  if (t.building === 'hospital' || t.amenity === 'hospital' || t.healthcare === 'hospital' ||
    HOSPITAL_NAME.test(name)) return 1;
  if (t.building === 'university' || t.building === 'college' || t.building === 'dormitory' ||
    t.amenity === 'university' || t.amenity === 'college' || t.office === 'university' ||
    UNIVERSITY_NAME.test(name)) return 2;
  return 0;
};

// Anchor use for the big non-residential boxes: 1 retail/mall, 2 industrial/warehouse, 3 rail/depot, 4 sport/leisure,
// 5 utility. Civic campuses (hospitals, universities, schools) are deliberately 0: they already have their own profile
// and an anchor would carve a campus wing out of a block laid out as a campus. The order matters: a hospital called
// "Szpital HCP" must not become an industrial hall because of "HCP", and a station's retail arcade is still a station.
const RETAIL_KINDS = new Set(['retail', 'commercial', 'supermarket', 'department_store', 'wholesale', 'shop',
  'marketplace', 'kiosk', 'stall']);
const INDUSTRIAL_KINDS = new Set(['industrial', 'warehouse', 'warehouses', 'factory', 'manufacture', 'hangar', 'shed',
  'service', 'utility', 'transformer_tower', 'water_tower', 'storage_tank', 'silo', 'greenhouse', 'barn', 'stable',
  'digester', 'gasometer', 'cooling_tower', 'slurry_tank']);
const RAIL_KINDS = new Set(['train_station', 'transportation', 'station', 'railway_station', 'bus_station',
  'engine_shed', 'signal_box']);
const SPORT_KINDS = new Set(['stadium', 'sports_hall', 'sports_centre', 'arena', 'ice_rink', 'water_park',
  'swimming_pool', 'grandstand', 'riding_hall', 'exhibition_centre']);
const RETAIL_NAME = /posnania|avenida|stary browar|kupiec|galeria (panorama|pestka|mm|polskie meble|wroclaw)|king cross|poznań plaza|poznan plaza|^m1\b|castorama|makro|ikea|selgros|market|centrum handlowe|pawilon \d|targi|^mtp\b/i;
const RAIL_NAME = /dworzec|zajezdni|parowozownia|pkp|kolejow|bocznica|lokomotyw/i;
const SPORT_NAME = /stadion|\barena\b|hala sportow|lodowisko|term[y|y ]|basen|pływalni|plywalni|tor regat|korty|hala widowisk|olimpij|amfiteatr|hipodrom/i;
const INDUSTRIAL_NAME = /elektrociepłowni|elektrocieplowni|zakład|zaklad|warsztat|cegielski|volkswagen|spalarni|oczyszczalni|magazyn|hurtowni|chłodni|chlodni|fabryk|kopalni|cukrowni|zntk/i;
const UTILITY_NAME = /elektrociepłowni|elektrocieplowni|ciepłowni|elektrowni|energetyki/i;
const CIVIC_NAME = /szpital|klinik|przychodni|centrum medyczne|ambulator|sanatori|collegium|uniwers|uczel|akadem|politechnik|instytut|szkoła|szkola|liceum|technikum|\bawf\b/i;
const isCivicBuilding = (t) => t.building === 'hospital' || t.amenity === 'hospital' || t.healthcare ||
  t.building === 'university' || t.building === 'college' || t.building === 'dormitory' ||
  t.amenity === 'university' || t.amenity === 'college' || t.amenity === 'school' || t.office === 'university' ||
  CIVIC_NAME.test(`${t.name || ''} ${t['name:pl'] || ''}`);
const anchorUse = (t) => {
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  const kind = String(t.building || '').toLowerCase();
  if (isCivicBuilding(t)) return 0;
  if (RAIL_KINDS.has(kind) || t.railway || t.public_transport === 'station' || RAIL_NAME.test(name)) return 3;
  if (SPORT_KINDS.has(kind) || SPORT_KINDS.has(t.leisure) || t.sport || t['addr:street'] === 'Termalna' ||
    SPORT_NAME.test(name)) return 4;
  if (RETAIL_KINDS.has(kind) || t.shop || t.amenity === 'marketplace' || RETAIL_NAME.test(name)) return 1;
  if (t.power === 'plant' || t.power === 'substation' || t.man_made === 'cooling_tower' || t.man_made === 'chimney' ||
    t.man_made === 'silo' || t.man_made === 'storage_tank' || t.man_made === 'water_tower' ||
    UTILITY_NAME.test(name)) return 5;
  if (INDUSTRIAL_KINDS.has(kind) || t.man_made === 'works' || t.power || t.landuse === 'industrial' ||
    t.landuse === 'railway' || INDUSTRIAL_NAME.test(name)) return 2;
  if (kind === 'ruins' && /zntk|naprawcze|zakłady|zaklady|warsztat/i.test(
    `${t.wikipedia || ''} ${t.wikidata || ''} ${name}`)) return 2;
  return 0;
};

// Only real buildings of this size keep a park lot: smaller sheds, kiosks and toilets would turn one 20 m park cell
// into a full lot and outbuild the real facility. Hala Arena (7,843 m²), Enea Stadion (52,909) and the Chwiałka ice
// rink (3,389) are far above it.
const PARK_BUILDING_MIN = 150;

// Public/sports/show facilities whose parkland lots must survive parkFreeCells. Schools, offices and ordinary park
// pavilions stay with the generic park carve-out: they are not open-ground facilities and keeping every OSM envelope
// in a park block (4,166 on the 2026-10-28 snapshot) pushed ordinary districts such as Chartowo over their OSM share.
const FACILITY_LEISURE = new Set(['stadium', 'sports_hall', 'sports_centre', 'arena', 'ice_rink', 'water_park',
  'swimming_pool', 'track', 'fitness_centre', 'recreation_ground']);
const FACILITY_BUILDING = new Set(['stadium', 'sports_hall', 'arena', 'grandstand', 'sports_centre', 'ice_rink',
  'public', 'civic', 'government', 'museum', 'theatre', 'cinema', 'exhibition_centre', 'community_centre',
  'cultural_centre']);
const FACILITY_AMENITY = new Set(['theatre', 'cinema', 'museum', 'arts_centre', 'exhibition_centre',
  'conference_centre', 'community_centre', 'public_building', 'townhall', 'library']);
const FACILITY_NAME = new RegExp('stadion|\\barena\\b|hala widowisk|hala sportow|lodowisko|pływalni|plywalni|basen|' +
  'termy|sportow|olimpij|tor regat|korty|hipodrom|amfiteatr|filharmoni|\\bopera\\b|muzeum|teatr|centrum wystaw|targi|' +
  'expo', 'i');
const isFacilityBuilding = (t) => {
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  return (t.leisure && FACILITY_LEISURE.has(t.leisure)) || (t.building && FACILITY_BUILDING.has(t.building)) ||
    (t.amenity && FACILITY_AMENITY.has(t.amenity)) || !!t.sport || t['addr:street'] === 'Termalna' ||
    FACILITY_NAME.test(name);
};

const W = R.w, H = R.h;
const buildingMask = new Uint8Array(W * H);
const buildings = [];
let skipped = 0, dup = 0, tagged = 0;
for (const e of osm.elements) {
  const kind = e.tags && e.tags.building;
  if (!kind || SKIP.has(kind)) { skipped++; continue; }
  if (e.type === 'way' && relOuter.has(e.id)) { dup++; continue; }
  const outer = elemRings(e, toWorld).filter((r) => r.length > 3);
  if (!outer.length) continue;
  const inner = elemRings(e, toWorld, 'inner').filter((r) => r.length > 3);
  // Area centroid of the outer rings (holes rarely move it far, and the centroid only picks the block); bbox for the
  // park lot carve-out in blockFootprints
  let a = 0, cx = 0, cz = 0;
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const r of outer) {
    for (const [x, z] of r) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (z < bz0) bz0 = z;
      if (z > bz1) bz1 = z;
    }
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const c = r[k][0] * r[i][1] - r[i][0] * r[k][1];
      a += c; cx += (r[k][0] + r[i][0]) * c; cz += (r[k][1] + r[i][1]) * c;
    }
  }
  if (!a) continue;
  cx /= 3 * a; cz /= 3 * a;
  const levels = parseLevels(e.tags['building:levels']);
  if (levels) tagged++;
  let cells = 0;
  const byLabel = new Map();
  const boxByLabel = new Map(); // label -> [i0, i1, j0, j1] of this footprint's cells in that block
  scanRings(inner.length ? outer.concat(inner) : outer, R, (i, j) => {
    const k = j * W + i;
    buildingMask[k] = 1;
    cells++;
    const L = lab[k];
    if (L) {
      byLabel.set(L, (byLabel.get(L) || 0) + 1);
      const bb = boxByLabel.get(L);
      if (!bb) boxByLabel.set(L, [i, i, j, j]);
      else {
        if (i < bb[0]) bb[0] = i;
        if (i > bb[1]) bb[1] = i;
        if (j < bb[2]) bb[2] = j;
        if (j > bb[3]) bb[3] = j;
      }
    }
  });
  const ci = Math.floor((cx - R.x0) / R.res), cj = Math.floor((cz - R.z0) / R.res);
  let label = ci >= 0 && cj >= 0 && ci < W && cj < H ? lab[cj * W + ci] : 0;
  if (!label) {
    let best = 0;
    for (const [L, n] of byLabel) if (n > best) { best = n; label = L; }
  }
  const cb = label ? boxByLabel.get(label) : null;
  // The anchor envelope is the footprint's own cells in this block, not its full OSM bbox: an object clipped by the
  // detail-box edge (M1, Selgros) must not turn into a building spanning the whole curb island.
  const inBoxBox = cb ? [R.x0 + cb[0] * R.res, R.x0 + (cb[1] + 1) * R.res,
    R.z0 + cb[2] * R.res, R.z0 + (cb[3] + 1) * R.res] : null;
  buildings.push({ id: e.id, levels, use: buildingUse(e.tags || {}), anchorUse: anchorUse(e.tags || {}), cells,
    facility: isFacilityBuilding(e.tags || {}), civic: isCivicBuilding(e.tags || {}),
    area: Math.abs(outer.reduce((t, r) => t + ringArea(r), 0)), cx, cz, label, bbox: [bx0, bx1, bz0, bz1], inBoxBox });
}

// --- Per-block stats -----------------------------------------------------------------------------------------------
const builtByLabel = new Map();
for (let k = 0; k < W * H; k++) if (buildingMask[k] && lab[k]) builtByLabel.set(lab[k], (builtByLabel.get(lab[k]) || 0) + 1);
const inBlock = new Map();
for (const b of buildings) {
  if (!b.label) continue;
  if (!inBlock.has(b.label)) inBlock.set(b.label, []);
  inBlock.get(b.label).push(b);
}
// Area-weighted median of the tagged storeys: the level at which half the tagged footprint area is reached, so one big
// tagged hall outweighs a yard of tagged sheds. Footprint area is the building's cell count (in-box), or its ring area
// for footprints too thin to cover a cell centre.
const medianLevels = (list) => {
  const t = list.filter((b) => b.levels).map((b) => [b.levels, b.cells || b.area]).sort((p, q) => p[0] - q[0]);
  const total = t.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [lv, w] of t) if ((acc += w) >= total / 2) return Math.round(lv * 10) / 10;
  return 0;
};
const blockStats = blocks.map((b) => {
  const list = inBlock.get(b.label) || [];
  const built = Math.min(1, Math.round(((builtByLabel.get(b.label) || 0) / b.area) * 100) / 100);
  const hospitals = list.filter((x) => x.use === 1).length;
  const universities = list.filter((x) => x.use === 2).length;
  // A campus needs two tagged public buildings, or one hospital building on a 4-40 ha block that is otherwise
  // sparsely built (some Poznań hospitals tag only one wing). University blocks in the fairground keep FAIRGROUND
  const soloHospital = hospitals === 1 && b.area >= 40000 && b.area <= 400000 && built <= 0.25 && list.length >= 30;
  const program = hospitals >= 2 || soloHospital ? 1 : universities >= 2 ? 2 : 0;
  return [built, medianLevels(list), list.length, program];
});

// Park blocks keep the envelopes of their mapped buildings: parkFreeCells in city-config.js cuts park land out of the
// lots, and without this every large facility standing in a park (Hala Arena in Park Kasprowicza, Enea Stadion, the
// Chwiałka ice rink, Termy Maltańskie) lost its lot and the generator left an empty lawn. A block only gets entries
// when it carries park land, so the key stays small.
const blockIndexByLabel = new Map(blocks.map((b, i) => [b.label, i]));
const blockFootprints = {};
let parkFootprints = 0;
const q1 = (v) => Math.round(v * 10) / 10;
for (const b of buildings) {
  const i = blockIndexByLabel.get(b.label);
  if (i === undefined || !b.facility || !(blocks[i].park > 0) || b.area < PARK_BUILDING_MIN) continue;
  const id = blocks[i].id;
  // [x0, x1, z0, z1, area]: the envelope plus the OSM footprint area, so the runtime can shrink the rect to the real
  // built area (an oval stadium fills 76 % of its bbox) instead of overbuilding the whole rectangle.
  (blockFootprints[id] || (blockFootprints[id] = [])).push([...b.bbox.map(q1), Math.round(b.area)]);
  parkFootprints++;
}
log(`buildings: ${parkFootprints} footprints in ${Object.keys(blockFootprints).length} park blocks kept for the lot carve-out (>= ${PARK_BUILDING_MIN} m²)`);

// Block anchors: the 1-3 largest mapped non-residential footprints of each block, with their in-block envelope, area,
// use (see anchorUse) and OSM storeys. 600 m² keeps ordinary shops, sheds and kiosks out while catching every mall,
// big-box hall, depot and arena; a block whose only non-residential buildings are smaller keeps its largest one
// (>= 250 m²), so a small hall still gets a real footprint rather than a row of kamienice. Nested duplicates (a mall
// hall plus its parking deck) are dropped by envelope overlap, and civic campuses are left to the campus profile.
const ANCHOR_MIN = 600;
const ANCHOR_FALLBACK_MIN = 250;
const ANCHOR_MAX = 3;
const blockAnchors = {};
let anchorCount = 0, anchorBlocks = 0;
// A block is anchored only when its mapped non-residential footprints dominate its built mass (>= 30% of the block's
// OSM building cells), or when one of them is a mapped park facility (Hala Arena, Enea Stadion, Chwiałka). Without that
// gate a single 600 m² shop anchored a whole kamienica quarter and the block lost its housing: the city-wide balcony
// stack count fell from ~16.5k to 9.1k.
const ANCHOR_BUILT_SHARE = 0.3;
// Anchors also have to be a visible part of the island (>= 10% of its area), or be a mapped park facility: a couple
// of 1,300 m² shops on a 12 ha campus block are not the block's morphology and should not switch it to service yard.
const ANCHOR_BLOCK_SHARE = 0.1;
const nonResByLabel = new Map();
for (const b of buildings) {
  if (!b.label || !b.anchorUse) continue;
  nonResByLabel.set(b.label, (nonResByLabel.get(b.label) || 0) + Math.min(b.area, b.cells));
}
const rectOverlap = (a, b) => {
  const w = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const d = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
  return w > 0 && d > 0 ? w * d : 0;
};
for (const [label, list] of inBlock) {
  const i = blockIndexByLabel.get(label);
  if (i === undefined) continue;
  const candidates = list.filter((b) => b.anchorUse && b.inBoxBox)
    .map((b) => ({ b, area: Math.min(b.area, b.cells),
      boxArea: (b.inBoxBox[1] - b.inBoxBox[0]) * (b.inBoxBox[3] - b.inBoxBox[2]) }))
    .sort((p, q) => q.area - p.area);
  if (!candidates.length) continue;
  const builtCells = builtByLabel.get(label) || 0;
  const nonResCells = nonResByLabel.get(label) || 0;
  const anchorArea = candidates.reduce((sum, c) => sum + c.area, 0);
  const parkFacility = candidates.some((c) => c.b.facility) && blocks[i].park > 0.3;
  // A block that also holds a real campus building keeps its campus/generic layout: anchoring the MTP pavilions out of
  // block 770 took UAM Szamarzewo from 33% to 27%, and the AWF block 939 lost its sports halls entirely.
  const civic = list.some((b) => b.civic && Math.min(b.area, b.cells) >= 1000);
  if (civic || (!parkFacility && (!(nonResCells >= ANCHOR_BUILT_SHARE * builtCells) ||
    anchorArea < ANCHOR_BLOCK_SHARE * blocks[i].area))) continue;
  let pool = candidates.filter((c) => c.area >= ANCHOR_MIN);
  if (!pool.length) pool = candidates[0].area >= ANCHOR_FALLBACK_MIN ? [candidates[0]] : [];
  const chosen = [];
  for (const c of pool) {
    if (chosen.length >= ANCHOR_MAX) break;
    if (chosen.some((p) => rectOverlap(p.b.inBoxBox, c.b.inBoxBox) >
      0.5 * Math.min(p.boxArea, c.boxArea))) continue;
    chosen.push(c);
  }
  if (!chosen.length) continue;
  blockAnchors[blocks[i].id] = chosen.map(({ b, area }) => [
    ...b.inBoxBox.map(q1), Math.round(area), b.anchorUse, b.levels
  ]);
  anchorCount += chosen.length;
  anchorBlocks++;
}
log(`buildings: ${anchorCount} anchors in ${anchorBlocks} blocks (>= ${ANCHOR_MIN} m², largest ${ANCHOR_MAX})`);

const emitted = new Set(blocks.map((b) => b.label));
const inBlocks = buildings.filter((b) => emitted.has(b.label)).length;
const blockArea = blocks.reduce((t, b) => t + b.area, 0);
const builtArea = blocks.reduce((t, b) => t + (builtByLabel.get(b.label) || 0), 0);
log(`buildings: ${osm.elements.length} elements, ${buildings.length} footprints (${skipped} roof/no skipped, ${dup} relation outers deduplicated), building:levels on ${tagged} (${Math.round((tagged / buildings.length) * 100)} %)`);
log(`buildings: ${inBlocks} in a block, ${blocks.filter((b, i) => blockStats[i][2]).length} of ${blocks.length} blocks hold one; built ${(builtArea / 1e6).toFixed(2)} km² of ${(blockArea / 1e6).toFixed(2)} km² block land (${Math.round((builtArea / blockArea) * 100)} %), ${Date.now() - T0} ms`);

export { blockStats, blockFootprints, blockAnchors, buildingMask, buildings };
