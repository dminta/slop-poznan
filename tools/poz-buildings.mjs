// tools/poz-buildings.mjs — real building density per block for tools/build-poznan.mjs (docs/poznan-plan.md Phase 14):
// the OSM building footprints (poz_buildings.json) rasterised on the poz-blocks.mjs 1 m block raster. Work happens at
// import time. The footprints themselves are not emitted (several MB); only the per-block stats are.
//
// - Footprints: every building way, and every building multipolygon relation as its chained outer rings minus its
//   chained inner rings (even-odd). A way that is also the outer member of a building relation is skipped, so a
//   building tagged on both is counted once.
// - building=roof (1,038 elements on the 2026-10-28 snapshot: platform and petrol-station canopies, market roofs) and
//   building=no are left out of the built mass: they have no walls. The roofs are not lost, though: poz-canopies.mjs
//   turns their outlines into GEO.canopies for the open, column-supported canopies in js/canopies.js.
//   building=construction (60) is kept: a site under construction (AND2) is a built lot, not an empty one.
// - Each building belongs to the block under its area centroid; when that falls off every block (on a sidewalk cut, a
//   service lane or outside the box), to the block holding most of its cells.
//
// Exports: blockStats [[built share, median levels, buildings, program], ...] aligned with poz-blocks `blocks` (program
// 0 none, 1 hospital/clinic campus, 2 university campus, from building tags and names); blockFootprints ({ block id:
// [[x0, x1, z0, z1, area], ...] }) for park blocks only, the axis-aligned envelopes of their mapped sport/show/public
// facilities of at least PARK_BUILDING_MIN area (buildings.js keeps those park cells as lots, so a stadium or arena is
// not cleared to lawn);
// buildingMask (Uint8Array over blockRaster, 1 = under a counted footprint); buildings [{ id, levels, use, cells, cx,
// cz, label }].
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
  scanRings(inner.length ? outer.concat(inner) : outer, R, (i, j) => {
    const k = j * W + i;
    buildingMask[k] = 1;
    cells++;
    const L = lab[k];
    if (L) byLabel.set(L, (byLabel.get(L) || 0) + 1);
  });
  const ci = Math.floor((cx - R.x0) / R.res), cj = Math.floor((cz - R.z0) / R.res);
  let label = ci >= 0 && cj >= 0 && ci < W && cj < H ? lab[cj * W + ci] : 0;
  if (!label) {
    let best = 0;
    for (const [L, n] of byLabel) if (n > best) { best = n; label = L; }
  }
  buildings.push({ id: e.id, levels, use: buildingUse(e.tags || {}), cells, facility: isFacilityBuilding(e.tags || {}),
    area: Math.abs(outer.reduce((t, r) => t + ringArea(r), 0)), cx, cz, label,
    bbox: [bx0, bx1, bz0, bz1] });
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

const emitted = new Set(blocks.map((b) => b.label));
const inBlocks = buildings.filter((b) => emitted.has(b.label)).length;
const blockArea = blocks.reduce((t, b) => t + b.area, 0);
const builtArea = blocks.reduce((t, b) => t + (builtByLabel.get(b.label) || 0), 0);
log(`buildings: ${osm.elements.length} elements, ${buildings.length} footprints (${skipped} roof/no skipped, ${dup} relation outers deduplicated), building:levels on ${tagged} (${Math.round((tagged / buildings.length) * 100)} %)`);
log(`buildings: ${inBlocks} in a block, ${blocks.filter((b, i) => blockStats[i][2]).length} of ${blocks.length} blocks hold one; built ${(builtArea / 1e6).toFixed(2)} km² of ${(blockArea / 1e6).toFixed(2)} km² block land (${Math.round((builtArea / blockArea) * 100)} %), ${Date.now() - T0} ms`);

export { blockStats, blockFootprints, buildingMask, buildings };
