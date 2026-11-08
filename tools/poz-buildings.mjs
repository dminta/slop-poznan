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
// - poz_industry.json adds the industrial and utility structures that `building=*` misses: cooling towers, chimneys,
//   silos, storage tanks, works and power plants/substations. Their closed outlines are counted like buildings (sites
//   without a built outline only classify the block), so EC Garbary and the wastewater works have real volumes. A way
//   that is also a relation's outer member is counted once, as for buildings.
//
// Exports: blockStats [[built share, median levels, buildings, program], ...] aligned with poz-blocks `blocks` (program
// 0 none, 1 hospital/clinic campus, 2 university campus, 3 retail/mall, 4 industrial, 5 rail/depot, 6 sport/stadium/arena,
// 7 utility, 8 leisure/water park, 9 office campus, 10 education, 11 sacral, 12 civic/public; a non-campus programme needs >= 40 % of the
// block's footprint area, so one 7.7 ha mall outweighs 30 kamienice); blockFootprints ({ block id: [[x0, x1, z0, z1, area], ...] })
// for park blocks only, the axis-aligned envelopes of their mapped sport/show/public facilities of at least PARK_BUILDING_MIN
// area (buildings.js keeps those park cells as lots, so a stadium or arena is not cleared to lawn); blockAnchors ({ block id:
// [[x0, x1, z0, z1, area, use, levels], ...] }), the 1-3 largest mapped non-residential footprints of each block (use 1 retail,
// 2 industrial, 3 rail/depot, 4 sport/leisure, 5 utility), with their in-block raster envelope and OSM storeys;
// blockObjects ({ block id: [[cx, cz, w, d, ang, area, use, levels], ...] }), every mapped non-residential building >= 100 m²
// (adds 6 education, 7 sacral, 8 health, 9 civic, 10 office) on its oriented minimum-area OSM rectangle; blockFallbackLots
// ({ block id: [[x0, x1, z0, z1, area], ...] }), buildings >= 60 m² whose footprint the raw lot grid never covered;
// industry ([{ kind, x, z, w, d, h, area, block }]) the industrial structures and plant/substation sites inside the
// detail box, for the runtime's chimney/cooling-tower meshes; buildingMask (Uint8Array over blockRaster, 1 = under a
// counted footprint); buildings [{ id, levels, use, cells, cx, cz, label, anchorUse }].
import { load, log, toWorld, inDetailBox } from './poz-base.mjs';
import { elemRings, ringArea, scanRings } from './geo-util.mjs';
import { blocks, blockRaster as R, blockLabels as lab } from './poz-blocks.mjs';

const T0 = Date.now();
const osm = load('poz_buildings.json');
const industryOsm = load('poz_industry.json');
const SKIP = new Set(['roof', 'no']);
const relOuter = new Set();
const industryRelOuter = new Set();
for (const e of osm.elements) {
  if (e.type !== 'relation') continue;
  for (const m of e.members || []) if (m.type === 'way' && m.role === 'outer') relOuter.add(m.ref);
}
for (const e of industryOsm.elements) {
  if (e.type !== 'relation') continue;
  for (const m of e.members || []) if (m.type === 'way' && m.role === 'outer') industryRelOuter.add(m.ref);
}
const blockIndexByLabel = new Map(blocks.map((b, i) => [b.label, i]));

// "3", "4.5", "3;5" (the higher part wins) or junk; storeys above ground as a positive number, else 0
const parseLevels = (v) => {
  if (!v) return 0;
  const n = Math.max(...String(v).split(/[;,-]/).map((s) => parseFloat(s)).filter((x) => x > 0 && x < 100));
  return Number.isFinite(n) ? n : 0;
};

// Building use for the block programme: 1 hospital/clinic, 2 university/college, 3 retail/mall, 4 industrial,
// 5 rail/depot, 6 sport/stadium/arena, 7 utility, 8 leisure/water park, 9 office campus. OSM tags the large hospital
// campuses either as building=hospital or by name (Szpital, Klinika, Collegium); a block with a single hospital building
// still counts when it is a large, sparsely built campus (see the program threshold below). The non-campus classes follow the tags
// first and the name only for objects OSM leaves as building=yes (Posnania, Castorama, Castorama's shopping park,
// Garbary's generator hall, Termy Maltańskie at addr:street=Termalna). Order matters: a power station is not an
// industrial hall, and a stadium's grandstand is not a warehouse.
// Curated storey corrections where OSM under-tags a real height. King Cross Marcelin (way 341510638) carries
// building:levels=2, but the mall hall is a 13-15 m box; 4 levels keeps fillAnchor above its 3-storey minimum.
const LEVEL_CORRECTIONS = new Map([[341510638, 4]]);
const HOSPITAL_NAME = /szpital|klinik|przychodni|centrum medyczne|ambulator|sanatori/i;
const UNIVERSITY_NAME = /collegium|uniwers|uczel|akadem|politechnik|instytut/i;
const HOSPITAL_BUILDING = new Set(['hospital']);
const UNIVERSITY_BUILDING = new Set(['university', 'college', 'dormitory']);
const EDUCATION_BUILDING = new Set(['school', 'kindergarten']);
const SACRAL_BUILDING = new Set(['church', 'chapel', 'monastery', 'convent', 'presbytery', 'cathedral', 'mosque',
  'synagogue', 'shrine', 'wayside_shrine', 'religious']);
const CIVIC_BUILDING = new Set(['public', 'civic', 'government', 'townhall', 'library', 'museum', 'theatre', 'cinema',
  'exhibition_centre', 'community_centre', 'cultural_centre']);
const CIVIC_AMENITY = new Set(['theatre', 'cinema', 'museum', 'arts_centre', 'exhibition_centre', 'conference_centre',
  'community_centre', 'public_building', 'townhall', 'library']);
const EDUCATION_NAME = /szko[łl]a|szkola|liceum|technikum|przedszkol|gimnazjum|żłobek|zlobek/i;
const SACRAL_NAME = /kości[oó][łl]|kosciol|katedra|bazylika|kaplica|klasztor|sanktuarium|cerkiew/i;
const CIVIC_NAME_USE = /urz[ąa]d|s[ąa]d|bibliotek|muzeum|teatr|kino|filharmoni|opera|centrum kultury|dom kultury|ratusz/i;
const OFFICE_BUILDING = new Set(['office']);
const RETAIL_BUILDING = new Set(['retail', 'commercial', 'supermarket', 'department_store', 'wholesale', 'kiosk', 'shop',
  'marketplace', 'hall']);
const INDUSTRIAL_BUILDING = new Set(['industrial', 'warehouse', 'warehouses', 'factory', 'manufacture', 'hangar',
  'shed', 'service', 'transformer_tower', 'utility', 'water_tower', 'storage_tank', 'silo', 'greenhouse', 'barn', 'stable',
  'digester', 'gasometer', 'cooling_tower', 'slurry_tank', 'ruins']);
const RAIL_BUILDING = new Set(['train_station', 'transportation', 'station', 'railway_station', 'bus_station']);
const SPORT_BUILDING = new Set(['stadium', 'sports_hall', 'arena', 'grandstand', 'sports_centre', 'ice_rink']);
const SPORT_LEISURE = new Set(['stadium', 'sports_hall', 'sports_centre', 'arena', 'ice_rink', 'water_park',
  'swimming_pool', 'track', 'fitness_centre', 'recreation_ground']);
const RETAIL_NAME = /posnania|avenida|stary browar|kupiec|galeria (panorama|pestka|mm|polskie meble|wroclaw)|king cross|poznań plaza|poznan plaza|^m1\b|castorama|makro|obi\b|ikea|selgros|decathlon|homepark|gigamarket|miasto wnętrz|centrum handlowe|park handlowy|market|supermarket|leroy|auchan|carrefour|tesco|kaufland|biedronka|lidl|netto|pawilon \d|targi|^mtp\b/i;
const INDUSTRIAL_NAME = /elektrociepłowni|elektrocieplowni|zakład|zaklad|hala (produkcyjna|zajezdni)|warsztat|hcp|cegielski|volkswagen|spalarni|oczyszczalni|magazyn|hurtowni|chłodni|chlodni|fabryk|kopalni|cukrowni|zntk|naprawcze/i;
const RAIL_NAME = /dworzec|zajezdni|parowozownia|pkp|kolejow|zntk|bocznica|lokomotyw/i;
const SPORT_NAME = /stadion|arena|hala widowisk|hala sportow|lodowisko|term[y|y ]|basen|pływalni|plywalni|sportow|olimpij|tor regat|korty|amfiteatr|hipodrom/i;
const UTILITY_NAME = /elektrociepłowni|elektrocieplowni|elektrowni|transformator|przepompowni|oczyszczalni|spalarni|kotłowni|kotlowni|ciepłowni|energetyki/i;
const ZNTK_RUINS = /zntk|naprawcze|zakład|zaklad|warsztat/i;
// EC Garbary turbine and boiler halls (unnamed building=yes in OSM)
const GARBARY_WAYS = new Set([81124883, 81124840, 244931832, 244931833, 244931834, 441915937]);

const buildingUse = (t, id) => {
  if (id && GARBARY_WAYS.has(id)) return 7;
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  const kind = String(t.building || '').toLowerCase();
  if (HOSPITAL_BUILDING.has(kind) || t.amenity === 'hospital' || t.healthcare === 'hospital' ||
    HOSPITAL_NAME.test(name)) return 1;
  if (UNIVERSITY_BUILDING.has(kind) || t.amenity === 'university' || t.amenity === 'college' ||
    t.office === 'university' || UNIVERSITY_NAME.test(name)) return 2;
  // Office campuses (Business Garden Marcelin and other building=office blocks): modern 4-6 storey pavilions round
  // courtyards, not the district's kamienice. Office blocks tagged only office=* keep the district profile.
  if (kind === 'office') return 9;
  // Termy Maltańskie at addr:street=Termalna carries only building=yes and an address
  if (t['addr:street'] === 'Termalna' || t.leisure === 'water_park' || /termy|aquapark|water ?park/i.test(name)) return 8;
  if (SPORT_BUILDING.has(kind) || SPORT_LEISURE.has(t.leisure) || !!t.sport || SPORT_NAME.test(name)) return 6;
  if (kind === 'utility' || t.power === 'plant' || t.power === 'substation' || t['historic:power'] ||
    t['generator:method'] || t['plant:method'] || t.man_made === 'works' || t.man_made === 'cooling_tower' ||
    t.man_made === 'chimney' || t.industrial === 'cooling' || t.man_made === 'storage_tank' ||
    t.man_made === 'water_tower' || t['addr:street'] === 'Świętego Wincentego' || UTILITY_NAME.test(name)) return 7;
  if (RAIL_BUILDING.has(kind) || !!t.railway || t.public_transport === 'station' || RAIL_NAME.test(name)) return 5;
  // Civil classes that used to fall through to the district profile (audit 2026-11-08): schools/kindergartens 10,
  // places of worship 11 and civic/public buildings 12. Universities and hospitals keep their campus programmes 2/1;
  // the check order matters, as a university church is an education building and a hospital office is health.
  if (EDUCATION_BUILDING.has(kind) || t.amenity === 'school' || t.amenity === 'kindergarten' ||
    EDUCATION_NAME.test(name)) return 10;
  if (SACRAL_BUILDING.has(kind) || t.amenity === 'place_of_worship' || t.religion || SACRAL_NAME.test(name)) return 11;
  if (CIVIC_BUILDING.has(kind) || CIVIC_AMENITY.has(t.amenity) || CIVIC_NAME_USE.test(name)) return 12;
  if (RETAIL_BUILDING.has(kind) || !!t.shop || t.amenity === 'marketplace' || RETAIL_NAME.test(name)) return 3;
  if (INDUSTRIAL_BUILDING.has(kind) || t.landuse === 'industrial' || t.industrial || t.man_made === 'works' ||
    t.man_made === 'silo' || t.man_made === 'storage_tank' || INDUSTRIAL_NAME.test(name)) return 4;
  // ZNTK Robocza's halls are building=ruins; a generic ruin (Cytadela's fort) is not an industrial hall.
  if (kind === 'ruins' && ZNTK_RUINS.test(`${t.wikipedia || ''} ${t.wikidata || ''} ${name}`)) return 4;
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

// Per-object use for GEO.blockObjects: the mapped non-residential buildings the district profile cannot represent.
// Codes match anchorUse where possible (1 retail/mall, 2 industrial/warehouse, 3 rail/depot, 4 sport/leisure,
// 5 utility) and add the civil classes the 2026-11-08 audit found omitted: 6 education, 7 sacral, 8 health,
// 9 civic, 10 office. Unlike anchorUse this does NOT return 0 for civic campuses: each mapped school, clinic, church
// or office is its own object, so a campus keeps its wings instead of losing them to the generic aggregate.
const objectUse = (t, id) => {
  const name = `${t.name || ''} ${t['name:pl'] || ''}`;
  const kind = String(t.building || '').toLowerCase().split(';')[0];
  if (!kind || SKIP.has(kind)) return 0;
  if (GARBARY_WAYS.has(id)) return 5;
  if (HOSPITAL_BUILDING.has(kind) || t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare ||
    HOSPITAL_NAME.test(name)) return 8;
  if (EDUCATION_BUILDING.has(kind) || UNIVERSITY_BUILDING.has(kind) || t.amenity === 'school' ||
    t.amenity === 'kindergarten' || t.amenity === 'university' || t.amenity === 'college' || t.office === 'university' ||
    EDUCATION_NAME.test(name) || UNIVERSITY_NAME.test(name)) return 6;
  if (SACRAL_BUILDING.has(kind) || t.amenity === 'place_of_worship' || t.religion || SACRAL_NAME.test(name)) return 7;
  if (CIVIC_BUILDING.has(kind) || CIVIC_AMENITY.has(t.amenity) || CIVIC_NAME_USE.test(name)) return 9;
  if (OFFICE_BUILDING.has(kind) || t.office) return 10;
  if (RAIL_KINDS.has(kind) || t.railway || t.public_transport === 'station' || RAIL_NAME.test(name)) return 3;
  if (SPORT_KINDS.has(kind) || SPORT_KINDS.has(t.leisure) || t.sport || SPORT_NAME.test(name)) return 4;
  if (RETAIL_KINDS.has(kind) || t.shop || t.amenity === 'marketplace' || RETAIL_NAME.test(name)) return 1;
  if (t.power === 'plant' || t.power === 'substation' || t.man_made === 'cooling_tower' || t.man_made === 'chimney' ||
    t.man_made === 'silo' || t.man_made === 'storage_tank' || t.man_made === 'water_tower' ||
    UTILITY_NAME.test(name)) return 5;
  if (INDUSTRIAL_KINDS.has(kind) || t.man_made === 'works' || t.power || t.landuse === 'industrial' ||
    t.landuse === 'railway' || INDUSTRIAL_NAME.test(name)) return 2;
  return 0;
};

// Oriented minimum-area rectangle of a footprint ring (same fit as poz-canopies): the object is built on its own
// orientation instead of a world AABB, so a diagonal hall does not fill a much larger axis-aligned box. Stored with the
// OSM ring area; the runtime shrinks the rectangle to that area when the plan is not a full rectangle (an L-shaped
// school) and keeps the rest of the block generic.
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const normAngle = (a) => {
  while (a < -Math.PI / 2) a += Math.PI;
  while (a >= Math.PI / 2) a -= Math.PI;
  return a;
};
function minRect(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cs = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of hull) {
      const u = x * cs + z * sn, v = -x * sn + z * cs;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, th, cs, sn, u0, u1, v0, v1 };
  }
  const midU = (best.u0 + best.u1) * 0.5, midV = (best.v0 + best.v1) * 0.5;
  const cx = midU * best.cs - midV * best.sn;
  const cz = midU * best.sn + midV * best.cs;
  let ang = normAngle(best.th);
  let w = best.u1 - best.u0, d = best.v1 - best.v0;
  if (d > w) {
    [w, d] = [d, w];
    ang = normAngle(ang + Math.PI / 2);
  }
  return { cx, cz, w, d, ang, area: best.area };
}
const obbBounds = (o) => {
  const cs = Math.cos(o.ang), sn = Math.sin(o.ang);
  const hw = o.w * 0.5, hd = o.d * 0.5;
  const xs = [], zs = [];
  for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    xs.push(o.cx + u * cs - v * sn);
    zs.push(o.cz + u * sn + v * cs);
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
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

// Industrial structure classification for the industry snapshot: only the closed outlines of built structures join the
// mask; works and power/substation polygons are sites and only classify the block (a landuse ring is not built mass).
const STRUCTURE_KIND = (t) => {
  if (t.man_made === 'cooling_tower' || t.industrial === 'cooling') return 'cooling';
  if (t.man_made === 'chimney') return 'chimney';
  if (t.man_made === 'silo') return 'silo';
  if (t.man_made === 'storage_tank') return 'tank';
  if (t.man_made === 'works') return 'works';
  if (t.power === 'plant') return 'plant';
  if (t.power === 'substation') return 'substation';
  return null;
};
const STRUCTURE_DEFAULT_HEIGHT = { cooling: 55, chimney: 45, silo: 18, tank: 10, works: 12, plant: 18, substation: 4 };
const parseHeight = (v) => {
  const n = parseFloat(String(v || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 500 ? n : 0;
};
const hasBuiltOutline = (t) => !!t.building && !SKIP.has(t.building);
const structureHeight = (t, kind) => parseHeight(t.height) || (parseLevels(t['building:levels']) * 3.4) ||
  STRUCTURE_DEFAULT_HEIGHT[kind] || 10;

const W = R.w, H = R.h;
const buildingMask = new Uint8Array(W * H);
// Raw lot rects (before splitDeep, minLot, park carve and landmark reserves) on the same 1 m raster: the fallback-lot
// pass needs to know which footprints the property-line grid never covered (the audit's 2,829 + 565 structural gap).
const rawLotMask = new Uint8Array(W * H);
for (const b of blocks) {
  for (const [th, px, pz, rects] of b.frames || [[0, 0, 0, b.rects]]) {
    const cs = Math.cos(th), sn = Math.sin(th);
    for (const [x0, x1, z0, z1] of rects) {
      const ring = th
        ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [
          px + (x - px) * cs + (z - pz) * sn, pz - (x - px) * sn + (z - pz) * cs
        ])
        : [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      scanRings([ring], R, (i, j) => { rawLotMask[j * W + i] = 1; });
    }
  }
}
const buildings = [];
const industry = [];
const buildingByKey = new Map();
let skipped = 0, dup = 0, tagged = 0;

// Shared by the building and industry passes: rings -> mask cells, centroid, bbox and block label.
function addFootprint(e, outer, inner, tags, levels, facility) {
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
  if (!a) return null;
  cx /= 3 * a; cz /= 3 * a;
  let cells = 0, rawCells = 0;
  const byLabel = new Map();
  const boxByLabel = new Map(); // label -> [i0, i1, j0, j1] of this footprint's cells in that block
  scanRings(inner.length ? outer.concat(inner) : outer, R, (i, j) => {
    const k = j * W + i;
    buildingMask[k] = 1;
    cells++;
    if (rawLotMask[k]) rawCells++;
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
  const area = Math.abs(outer.reduce((t, r) => t + ringArea(r), 0));
  const mainRing = outer.reduce((best, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best), outer[0]);
  const b = {
    id: e.id, levels, use: buildingUse(tags, e.id), anchorUse: anchorUse(tags || {}),
    objectUse: objectUse(tags || {}, e.id), facility, civic: isCivicBuilding(tags || {}), area, cells,
    rawShare: cells ? rawCells / cells : 0, cx, cz, label, obb: minRect(mainRing),
    bbox: [bx0, bx1, bz0, bz1], inBoxBox
  };
  buildings.push(b);
  buildingByKey.set(`${e.type}/${e.id}`, b);
  return b;
}

// Industry entries are also emitted for sites without a built outline, but only inside the detail box (the runtime
// never sees the padded edge; Karolin's towers live in the outskirts satellite layer).
function addIndustry(e, outer, tags, kind) {
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const r of outer) {
    for (const [x, z] of r) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (z < bz0) bz0 = z;
      if (z > bz1) bz1 = z;
    }
  }
  const [x0, x1, z0, z1] = [bx0, bx1, bz0, bz1];
  const x = (x0 + x1) * 0.5, z = (z0 + z1) * 0.5;
  if (!inDetailBox(x, z, 0)) return;
  const ci = Math.floor((x - R.x0) / R.res), cj = Math.floor((z - R.z0) / R.res);
  const label = ci >= 0 && cj >= 0 && ci < W && cj < H ? lab[cj * W + ci] : 0;
  const bi = blockIndexByLabel.get(label);
  industry.push({
    kind, x, z, w: x1 - x0, d: z1 - z0, h: structureHeight(tags, kind),
    area: Math.abs(outer.reduce((t, r) => t + ringArea(r), 0)), block: bi === undefined ? null : blocks[bi].id
  });
}

for (const e of osm.elements) {
  const kind = e.tags && e.tags.building;
  if (!kind || SKIP.has(kind)) { skipped++; continue; }
  if (e.type === 'way' && relOuter.has(e.id)) { dup++; continue; }
  const outer = elemRings(e, toWorld).filter((r) => r.length > 3);
  if (!outer.length) continue;
  const inner = elemRings(e, toWorld, 'inner').filter((r) => r.length > 3);
  const levels = LEVEL_CORRECTIONS.get(e.id) || parseLevels(e.tags['building:levels']);
  if (levels) tagged++;
  addFootprint(e, outer, inner, e.tags, levels, isFacilityBuilding(e.tags || {}));
  // Cooling towers and chimneys that already carry a building tag live in the building snapshot, not in the industry
  // query; they still need a runtime structure and the utility programme.
  const industryKind = STRUCTURE_KIND(e.tags || {});
  if (industryKind) addIndustry(e, outer, e.tags || {}, industryKind);
}

for (const e of industryOsm.elements) {
  const t = e.tags || {};
  const key = `${e.type}/${e.id}`;
  if (buildingByKey.has(key)) continue;
  if (e.type === 'way' && industryRelOuter.has(e.id)) { dup++; continue; }
  const kind = STRUCTURE_KIND(t);
  if (!kind) continue;
  const outer = elemRings(e, toWorld).filter((r) => r.length > 3);
  if (!outer.length) continue;
  const inner = elemRings(e, toWorld, 'inner').filter((r) => r.length > 3);
  // Sites (works, plants, substations) classify their block but are not built mass unless OSM gives them a building.
  if (hasBuiltOutline(t) || kind === 'cooling' || kind === 'chimney' || kind === 'silo' || kind === 'tank') {
    if (!buildingByKey.has(key)) {
      const levels = LEVEL_CORRECTIONS.get(e.id) || parseLevels(t['building:levels']);
      addFootprint(e, outer, inner, t, levels, isFacilityBuilding(t));
    }
  }
  addIndustry(e, outer, t, kind);
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
// A non-campus programme needs at least 40 % of the block's footprint area. Footprints are weighted by raster cells
// (or the ring area when a sliver covers no cell centre); the share is over every building in the block, so a 7.7 ha
// mall outvotes 30 kamienice and a hospital wing loses to the halls that fill the rest of an industrial block. Blocks
// under 0.4 ha or with under 150 m² of the use stay with the district profile: a 200 m² shop does not make a mall.
const PROGRAM_SHARE = 0.4;
const PROGRAM_BLOCK_MIN = 4000;
const PROGRAM_FOOTPRINT_MIN = 150;
const blockStats = blocks.map((b) => {
  const list = inBlock.get(b.label) || [];
  const built = Math.min(1, Math.round(((builtByLabel.get(b.label) || 0) / b.area) * 100) / 100);
  const areaByUse = new Map();
  let footprint = 0;
  for (const x of list) {
    const w = x.cells || x.area;
    footprint += w;
    if (x.use) areaByUse.set(x.use, (areaByUse.get(x.use) || 0) + w);
  }
  const hospitals = list.filter((x) => x.use === 1).length;
  const universities = list.filter((x) => x.use === 2).length;
  // A campus needs two tagged public buildings, or one hospital building on a 4-40 ha block that is otherwise
  // sparsely built (some Poznań hospitals tag only one wing). University blocks in the fairground keep FAIRGROUND
  const soloHospital = hospitals === 1 && b.area >= 40000 && b.area <= 400000 && built <= 0.25 && list.length >= 30;
  const campus = hospitals >= 2 || soloHospital ? 1 : universities >= 2 ? 2 : 0;
  let dominant = 0, dominantArea = 0;
  for (const [use, area] of areaByUse) {
    if (use >= 3 && area > dominantArea) { dominant = use; dominantArea = area; }
  }
  // The campus keeps a block when it has the larger footprint (a hospital campus with a shop row stays HOSPITAL);
  // the non-campus use wins when it is the dominant one (Antoninek's halls over its hospital wing).
  let program = campus;
  if (dominant && b.area >= PROGRAM_BLOCK_MIN && dominantArea >= PROGRAM_FOOTPRINT_MIN &&
    dominantArea >= PROGRAM_SHARE * footprint && dominantArea > (areaByUse.get(campus) || 0)) program = dominant;
  return [built, medianLevels(list), list.length, program];
});

// Park blocks keep the envelopes of their mapped buildings: parkFreeCells in city-config.js cuts park land out of the
// lots, and without this every large facility standing in a park (Hala Arena in Park Kasprowicza, Enea Stadion, the
// Chwiałka ice rink, Termy Maltańskie) lost its lot and the generator left an empty lawn. A block only gets entries
// when it carries park land, so the key stays small.
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

// Ordinary mapped buildings in park-heavy blocks (housing estates, allotment colonies, cemeteries, riverside gardens)
// also keep their own lots, not only the large facilities: parkFreeCells otherwise clears the block's whole real stock
// to lawn (875 Antoninek was 17 % built with no lot at all; 968 Rataje kept 25 % of its island as lots). Footprints of
// at least 60 m² keep sheds, kiosks and garages out; they are marked non-facility so buildings.js keeps the district's
// house or kamienica layout on them instead of one big hall. The runtime includes them only where the park carve
// leaves too few lots for the block's built share (city-config blockFootprints).
const PARK_HOUSE_MIN = 40;
const blockParkBuildings = {};
let parkBuildings = 0;
for (const b of buildings) {
  const i = blockIndexByLabel.get(b.label);
  if (i === undefined || b.facility || b.objectUse || !(blocks[i].park > 0.4) || b.area < PARK_HOUSE_MIN) continue;
  const id = blocks[i].id;
  (blockParkBuildings[id] || (blockParkBuildings[id] = [])).push([...(b.inBoxBox || b.bbox).map(q1), Math.round(b.area)]);
  parkBuildings++;
}
log(`buildings: ${parkBuildings} ordinary park buildings in ${Object.keys(blockParkBuildings).length} blocks kept for the lot carve-out (>= ${PARK_HOUSE_MIN} m²)`);

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

// Mapped object anchors: every non-residential footprint the district profile cannot represent, independently of the
// block gate above (audit 2026-11-08: 8,835 footprints have a lot but no profile). Each object is built on its own
// OSM envelope at its tagged storey count; the rest of the block still gets its normal generic layout. Dedupe nested
// OSM outlines (a hall and its annex) and anything already covered by a primary anchor or a park facility.
const OBJECT_MIN = 100;
const blockObjects = {};
let objectCount = 0, objectBlocks = 0;
for (const [label, list] of inBlock) {
  const i = blockIndexByLabel.get(label);
  if (i === undefined) continue;
  const id = blocks[i].id;
  const anchors = blockAnchors[id] || [];
  const park = blocks[i].park > 0;
  // Park-heavy blocks keep their calibrated park/facility layout and their building holes must stay disjoint; their
  // mapped buildings already enter through blockFootprints/blockParkBuildings.
  if (blocks[i].park > 0.4) continue;
  // Campus blocks already have their own hospital/university layout and tested density; an exact object there only
  // fragments the campus lots after its envelope is reserved, so the wings stay with the campus profile.
  if (blockStats[i][3] === 1 || blockStats[i][3] === 2) continue;
  const candidates = list.filter((b) => b.objectUse && b.obb && !(b.facility && park) && b.area >= OBJECT_MIN)
    .map((b) => ({ b, area: Math.round(b.area), bounds: obbBounds(b.obb),
      boxArea: b.obb.w * b.obb.d }))
    .sort((p, q) => q.area - p.area);
  const chosen = [];
  for (const c of candidates) {
    if (Math.min(c.b.obb.w, c.b.obb.d) < 4) continue;
    if (anchors.some((a) => rectOverlap(a, c.bounds) > 0.5 * Math.min(a[4], c.boxArea))) continue;
    if (chosen.some((p) => rectOverlap(p.bounds, c.bounds) > 0.5 * Math.min(p.boxArea, c.boxArea))) continue;
    chosen.push(c);
  }
  if (!chosen.length) continue;
  blockObjects[id] = chosen.map(({ b, area }) => [
    q1(b.obb.cx), q1(b.obb.cz), q1(b.obb.w), q1(b.obb.d), Math.round(b.obb.ang * 1e4) / 1e4,
    area, b.objectUse, b.levels
  ]);
  objectCount += chosen.length;
  objectBlocks++;
}
log(`buildings: ${objectCount} mapped objects in ${objectBlocks} blocks (>= ${OBJECT_MIN} m², education/sacral/health/civic/office and halls)`);

// Fallback lots: footprints the property-line grid never covered (the audit's property-line gap, block-without-lots and
// most of the zero-lot set). The runtime turns these envelopes into extra lots, so the generator can build on the real
// spot instead of losing the object between maskRects/fitRects. They are deliberately conservative (raw coverage below
// FALLBACK_RAW_MAX) to avoid doubling lots where the normal grid already has one; anchors, objects, park facilities and
// landmark reserves are subtracted by buildings.js before anything is built.
const FALLBACK_MIN = 60;
const FALLBACK_RAW_MAX = 0.35;
const blockFallbackLots = {};
let fallbackCount = 0, fallbackBlocks = 0;
for (const [label, list] of inBlock) {
  const i = blockIndexByLabel.get(label);
  if (i === undefined) continue;
  const id = blocks[i].id;
  const park = blocks[i].park;
  const candidates = list.filter((b) => !b.objectUse && b.inBoxBox && b.area >= FALLBACK_MIN &&
    b.rawShare < FALLBACK_RAW_MAX && !(b.facility && park > 0) && !(park > 0.4 && !b.facility && b.area >= PARK_HOUSE_MIN) &&
    Math.min(b.inBoxBox[1] - b.inBoxBox[0], b.inBoxBox[3] - b.inBoxBox[2]) >= 5)
    .map((b) => ({ b, area: Math.round(b.area),
      boxArea: (b.inBoxBox[1] - b.inBoxBox[0]) * (b.inBoxBox[3] - b.inBoxBox[2]) }))
    .sort((p, q) => q.area - p.area);
  const chosen = [];
  for (const c of candidates) {
    if (chosen.some((p) => rectOverlap(p.b.inBoxBox, c.b.inBoxBox) > 0.5 * Math.min(p.boxArea, c.boxArea))) continue;
    chosen.push(c);
  }
  if (!chosen.length) continue;
  blockFallbackLots[id] = chosen.map(({ b, area }) => [...b.inBoxBox.map(q1), area]);
  fallbackCount += chosen.length;
  fallbackBlocks++;
}
log(`buildings: ${fallbackCount} fallback lots in ${fallbackBlocks} blocks (>= ${FALLBACK_MIN} m², raw lot coverage < ${FALLBACK_RAW_MAX})`);

const emitted = new Set(blocks.map((b) => b.label));
const inBlocks = buildings.filter((b) => emitted.has(b.label)).length;
const blockArea = blocks.reduce((t, b) => t + b.area, 0);
const builtArea = blocks.reduce((t, b) => t + (builtByLabel.get(b.label) || 0), 0);
log(`buildings: ${osm.elements.length} elements, ${buildings.length} footprints (${skipped} roof/no skipped, ${dup} relation outers deduplicated), building:levels on ${tagged} (${Math.round((tagged / buildings.length) * 100)} %)`);
log(`buildings: ${inBlocks} in a block, ${blocks.filter((b, i) => blockStats[i][2]).length} of ${blocks.length} blocks hold one; built ${(builtArea / 1e6).toFixed(2)} km² of ${(blockArea / 1e6).toFixed(2)} km² block land (${Math.round((builtArea / blockArea) * 100)} %), ${Date.now() - T0} ms`);
log(`industry: ${industry.length} structures/sites inside the detail box (${industry.filter((s) => s.kind === 'chimney' || s.kind === 'cooling').length} chimneys/cooling towers), ${blockStats.filter((s) => s[3] >= 3).length} blocks with a non-campus programme`);

export { blockStats, blockFootprints, blockParkBuildings, blockAnchors, blockObjects, blockFallbackLots, industry, buildingMask, buildings };
