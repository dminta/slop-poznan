// tools/poz-extra.mjs — parks, landmarks, districts and place labels for tools/build-poznan.mjs (docs/poznan-plan.md §2,
// §4.2, §9.1). Everything exported is GEO-ready (flat [x0, z0, x1, z1, ...] rings, 0.1 m precision) except the park
// coverage inputs, which stay as [x, z] point rings for the block builder's scanline pass.
//
// Inputs (tools/data/; OpenStreetMap via Overpass, ODbL): poz_parks.json, poz_landmarks.json, poz_admin.json; the
// hand-placed area labels in poz_places.json

import { load, loadText, log, toWorld, DETAIL_BOX, inDetailBox } from './poz-base.mjs';
import { r1, ringArea, bbox, rdpRing, centroid, elemRings } from './geo-util.mjs';

const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
// Drop the closing vertex OSM repeats, simplify, and turn to the outputs' negative shoelace winding
function cleanRing(r, eps) {
  const pts = r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.01 ? r.slice(0, -1) : r.slice();
  const s = pts.length > 4 ? rdpRing(pts, eps) : pts;
  if (ringArea(s) > 0) s.reverse();
  return s;
}
const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;
const bbHitsBox = (b, pad) => b.x1 >= BX0 - pad && b.x0 <= BX1 + pad && b.z1 >= BZ0 - pad && b.z0 <= BZ1 + pad;
// Outer and inner rings of an element: ways are one outer ring, relations chain their members (elemRings only chains
// outers, so inners go through it with the roles swapped)
function outerInner(e) {
  if (e.type === 'way') return { outer: elemRings(e, toWorld), inner: [] };
  const swapped = { type: 'relation', members: (e.members || []).filter((m) => m.role === 'inner').map((m) => ({ ...m, role: 'outer' })) };
  return { outer: elemRings(e, toWorld).filter((r) => r.length > 3), inner: elemRings(swapped, toWorld).filter((r) => r.length > 3) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Parks
// ---------------------------------------------------------------------------------------------------------------------
// The snapshot covers the whole city: 4,839 elements, 3,306 of them landuse=grass / natural=wood patches. cat is the
// green tag's value; wood and forest are one cat (OSM uses both for the same kind of stand)
const PARK_CAT = {
  leisure: { park: 'park', garden: 'garden', playground: 'playground', pitch: 'pitch', recreation_ground: 'recreation' },
  landuse: { cemetery: 'cemetery', forest: 'forest', grass: 'grass', recreation_ground: 'recreation' },
  natural: { wood: 'forest' }
};
const catOf = (t) => PARK_CAT.leisure[t.leisure] || PARK_CAT.landuse[t.landuse] || PARK_CAT.natural[t.natural] || '';
const parkRings = [];
for (const e of load('poz_parks.json').elements) {
  const t = e.tags || {};
  const cat = catOf(t);
  if (!cat) continue; // sports_centre, greenfield, fitness_station: 3 stray elements
  const { outer, inner } = outerInner(e);
  if (!outer.length) continue;
  const area = outer.reduce((s, r) => s + Math.abs(ringArea(r)), 0) - inner.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
  parkRings.push({ id: `${e.type}/${e.id}`, name: t.name || '', cat, area_m2: Math.round(area), outer, inner, bb: bbox(outer.flat()) });
}
// Coverage counts patches of 1,000 m² and up: smaller ones are verges and courtyard lawns that never make a block read
// as parkland anyway
const COVER_MIN_M2 = 1000;
const coverParks = parkRings.filter((p) => p.area_m2 >= COVER_MIN_M2);
// 250 m buckets over the coverage parks' bboxes, so a block only scans the few parks near it
const BUCKET = 250;
const buckets = new Map();
for (const [n, p] of coverParks.entries()) {
  for (let i = Math.floor(p.bb.x0 / BUCKET); i <= Math.floor(p.bb.x1 / BUCKET); i++) {
    for (let j = Math.floor(p.bb.z0 / BUCKET); j <= Math.floor(p.bb.z1 / BUCKET); j++) {
      const k = `${i},${j}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(n);
    }
  }
}
function parksNear(b) {
  const out = new Set();
  for (let i = Math.floor(b.x0 / BUCKET); i <= Math.floor(b.x1 / BUCKET); i++) {
    for (let j = Math.floor(b.z0 / BUCKET); j <= Math.floor(b.z1 / BUCKET); j++) for (const n of buckets.get(`${i},${j}`) || []) out.add(n);
  }
  return [...out].sort((a, c) => a - c).map((n) => coverParks[n]);
}
// Even-odd scanline over every ring of one park at once (inner rings cut their holes), calling cell(i, j) for each
// raster cell whose centre is inside; the grid is { x0, z0, res, w, h } as in geo-util Raster
function scanPark(p, g, cell) {
  const rings = p.inner.length ? p.outer.concat(p.inner) : p.outer;
  const j0 = Math.max(0, Math.floor((p.bb.z0 - g.z0) / g.res)), j1 = Math.min(g.h - 1, Math.ceil((p.bb.z1 - g.z0) / g.res));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = g.z0 + (j + 0.5) * g.res;
    xs.length = 0;
    for (const ring of rings) {
      for (let a = 0, k = ring.length - 1; a < ring.length; k = a++) {
        const [xa, za] = ring[k], [xb, zb] = ring[a];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
    }
    xs.sort((u, v) => u - v);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - g.x0) / g.res - 0.5)), i1 = Math.min(g.w - 1, Math.floor((xs[n + 1] - g.x0) / g.res - 0.5));
      for (let i = i0; i <= i1; i++) cell(i, j);
    }
  }
}
// Park coverage over a labelled block raster (R: { x0, z0, res, w, h }, lab: label per cell, 0 = no block). Each cell
// counts once however many parks overlap it (a wood inside Park Cytadela would otherwise count twice). Returns
// Map label -> { cells, name }: name is the named park covering most of that label's cells ('' if none); share =
// cells / block cells, and poz-blocks.mjs only keeps the name when share > 0.25.
function parkCellsByLabel(R, lab) {
  const g = { x0: R.x0, z0: R.z0, res: R.res, w: R.w, h: R.h };
  const seen = new Uint8Array(g.w * g.h);
  const out = new Map();
  for (const p of coverParks) {
    const named = new Map();
    scanPark(p, g, (i, j) => {
      const c = j * g.w + i;
      const L = lab[c];
      if (!L) return;
      if (!seen[c]) {
        seen[c] = 1;
        const o = out.get(L);
        if (o) o.cells++;
        else out.set(L, { cells: 1, name: '', _best: 0 });
      }
      if (p.name) named.set(L, (named.get(L) || 0) + 1);
    });
    for (const [L, n] of named) {
      const o = out.get(L);
      if (n > o._best) { o._best = n; o.name = p.name; }
    }
  }
  for (const o of out.values()) delete o._best;
  return out;
}
// The same for one block outline ([[x, z], ...]) on its own 1 m grid: { share, name }, name only above 25 % (as above)
function parkCoverage(outline, res = 1) {
  const bb = bbox(outline);
  const g = { x0: Math.floor(bb.x0 / res) * res, z0: Math.floor(bb.z0 / res) * res, res };
  g.w = Math.ceil((bb.x1 - g.x0) / res) + 1;
  g.h = Math.ceil((bb.z1 - g.z0) / res) + 1;
  const inBlock = new Uint8Array(g.w * g.h);
  let total = 0;
  scanPark({ outer: [outline], inner: [], bb }, g, (i, j) => { inBlock[j * g.w + i] = 1; total++; });
  if (!total) return { share: 0, name: '' };
  const seen = new Uint8Array(g.w * g.h);
  let cells = 0, best = 0, name = '';
  for (const p of parksNear(bb)) {
    if (p.bb.x1 < bb.x0 || p.bb.x0 > bb.x1 || p.bb.z1 < bb.z0 || p.bb.z0 > bb.z1) continue;
    let n = 0;
    scanPark(p, g, (i, j) => {
      const c = j * g.w + i;
      if (!inBlock[c]) return;
      n++;
      if (!seen[c]) { seen[c] = 1; cells++; }
    });
    if (p.name && n > best) { best = n; name = p.name; }
  }
  const share = Math.min(1, Math.round((cells / total) * 100) / 100);
  return { share, name: share > 0.25 ? name : '' };
}

// Park outlines worth drawing (GEO.parks: the map's park layer and the city-grid park builder). Within the detail box
// padded by 500 m: named parks, gardens, cemeteries and woods of 2,000 m² and up, anything else of 1 ha and up (grass
// verges, pitches, playgrounds are dropped below that). Outside it, only named parks and cemeteries of 5 ha and up
// (Park Sołacki, Park Kasprowicza, Junikowo, Miłostowo) so the city map has its big greens. 1 m simplification inside,
// 3 m outside.
const DRAW_PAD = 500;
const parks = [];
for (const p of parkRings) {
  const inside = bbHitsBox(p.bb, DRAW_PAD);
  const keep = inside
    ? p.area_m2 >= 10000 || (p.area_m2 >= 2000 && (p.name || ['park', 'garden', 'cemetery', 'forest'].includes(p.cat)))
    : p.area_m2 >= 50000 && p.name && ['park', 'cemetery'].includes(p.cat);
  if (!keep) continue;
  const rings = p.outer.filter((r) => Math.abs(ringArea(r)) > 300).map((r) => flat(cleanRing(r, inside ? 1 : 3))).filter((r) => r.length >= 6);
  if (rings.length) parks.push({ name: p.name, cat: p.cat, area_m2: p.area_m2, rings });
}
{
  const byCat = {};
  for (const p of parks) (byCat[p.cat] ||= [0, 0]), (byCat[p.cat][0]++, byCat[p.cat][1] += p.area_m2);
  log(`parks: ${parkRings.length} green elements (${coverParks.length} >= ${COVER_MIN_M2} m² for block coverage), ${parks.length} outlines kept, ${(JSON.stringify(parks).length / 1024).toFixed(0)} KB`);
  log(`  by cat: ${Object.entries(byCat).sort().map(([c, [n, a]]) => `${c} ${n} (${(a / 1e4).toFixed(1)} ha)`).join(', ')}`);
  const big = ['Park Cytadela', 'Park Thomasa Woodrowa Wilsona', 'Park Adama Mickiewicza', 'Park Fryderyka Chopina', 'Park Sołacki'];
  log(`  ${big.map((n) => `${n} ${((parks.find((p) => p.name === n) || { area_m2: 0 }).area_m2 / 1e4).toFixed(1)} ha`).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Landmarks: real footprints as turned boxes, keyed by a short display name
// ---------------------------------------------------------------------------------------------------------------------
// OSM elements per key (found in poz_landmarks.json, 2026-10-25); the largest outline wins where several map to one key.
// Skipped: Nowy Rynek's landuse relation 15819392 (the whole site, not a building) and its lower buildings.
const LANDMARK_ELEMENTS = {
  'Ratusz': ['way/30611684'],
  'Fara': ['way/365954906'], // "Bazylika Kolegiacka Matki Bożej Nieustającej Pomocy, ..."
  'Zamek Królewski': ['way/363747422'],
  'Wieża Wójtowska': ['way/366976792'],
  'Domki Budnicze': ['way/343867707'], // unnamed, wikidata Q9209924
  'Katedra': ['way/279545051'],
  'Brama Poznania': ['way/441733580'],
  'Zamek Cesarski': ['relation/1483520'],
  'Bałtyk': ['way/490881244'], // no name tag, addr:housename=Bałtyk
  'Okrąglak': ['way/246117826'],
  'Collegium Minus': ['way/129557623'],
  'Teatr Wielki': ['way/343867710'],
  'Pomnik Czerwca 1956': ['node/9105702733'],
  'Poznań Główny': ['way/423143872'],
  'Stary Dworzec': ['relation/6294130'],
  'Avenida': ['way/368791550', 'way/368791540'], // the retail block and the car park over it
  'Stary Browar': ['way/181129696', 'way/199048095', 'relation/2648508', 'relation/2673396'],
  'Iglica': ['way/239060359'], // "Pawilon 11", man_made=tower tower:type=spire
  'Collegium Altum': ['way/239809211'],
  'Andersia': ['way/436542448'],
  'Poznań Financial Centre': ['way/37268304'],
  'Novotel': ['way/106179573'],
  'AND2': ['way/934950822'], // building=construction
  'Nowy Rynek': ['way/917582170'], // the 16-storey tower, taken to be Nowy Rynek E
  'Delta': ['way/106179571'], // the old Delta office block (11 storeys), not Delta 4
  'Biblioteka Raczyńskich': ['way/169874406'],
  'Pałac Działyńskich': ['way/366976799'],
  'Hotel Bazar': ['way/363880964'],
  'Muzeum Narodowe': ['way/35276947'],
  'Teatr Polski': ['way/104781039'],
  'Collegium Maius': ['relation/1021065'],
  'Kościół Bernardynów': ['way/439910263'],
  'Kościół Franciszkanów': ['way/104781037'],
  'Kościół Najświętszej Marii Panny': ['way/238040916'],
  'Kościół św. Wojciecha': ['way/129682752'],
  'Kościół Bożego Ciała': ['way/106179574']
};
// Heights (m) from §9.1 (pl.wikipedia / Wikidata: tower tops, spires, roof tops). These override OSM, whose height tags
// here are eaves (Ratusz 16 vs a ≈ 61 m tower), a lower wing (Collegium Altum 16 vs 103.35) or junk (Katedra 0.1).
// The second group are the tops of the Phase 7 models (js/landmarks-*.js), estimated from photos and storey counts
// where no figure is published (Fara: a 27 m nave plus vault and roof); confirm them with nDSM heights (§4.4)
const LANDMARK_H = {
  'Ratusz': 61, 'Katedra': 62, 'Zamek Cesarski': 75, 'Bałtyk': 67, 'Okrąglak': 45, 'Collegium Altum': 103.35,
  'Andersia': 102.1, 'Poznań Financial Centre': 91, 'Novotel': 68, 'Nowy Rynek': 66, 'AND2': 116, 'Iglica': 64,
  'Pomnik Czerwca 1956': 21,
  'Fara': 40, 'Zamek Królewski': 43, 'Brama Poznania': 18, 'Teatr Wielki': 27, 'Collegium Minus': 27,
  'Domki Budnicze': 14.4, 'Wieża Wójtowska': 20.5, 'Poznań Główny': 13.6, 'Stary Dworzec': 19.3, 'Avenida': 25.3,
  'Stary Browar': 42,
  'Biblioteka Raczyńskich': 18.6, 'Pałac Działyńskich': 22.25, 'Hotel Bazar': 24.4, 'Muzeum Narodowe': 26.0,
  'Teatr Polski': 23.9, 'Collegium Maius': 36.4, 'Kościół Bernardynów': 44.7, 'Kościół Franciszkanów': 32.6,
  'Kościół Najświętszej Marii Panny': 28.8, 'Kościół św. Wojciecha': 23.9, 'Kościół Bożego Ciała': 39.5
};
const LEVEL_H = 3.4;
// No curated height, no plausible OSM height and no levels: a placeholder until nDSM heights
const DEFAULT_H = 20;
// A node-only landmark (the 1956 crosses) gets a square of this side: the monument with its plinth and paving
const NODE_SIDE = 10;

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// Extents of pts in the frame turned by ang, in js/landmarks.js fitTurned's convention: local (u, w) sits at world
// (x + u cos + w sin, z - u sin + w cos), so u = x cos - z sin and w = x sin + z cos
function turnedBox(pts, ang) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * cs - z * sn, w = x * sn + z * cs;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (w < w0) w0 = w;
    if (w > w1) w1 = w;
  }
  const uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  return { x: uc * cs + wc * sn, z: -uc * sn + wc * cs, w: u1 - u0, d: w1 - w0 };
}
// Minimum-area bounding rectangle over the hull edges' directions. ang is folded into (-45°, 45°], so w/d stay the
// extents closest to world x/z and a consumer that ignores ang still gets a sensible box
function minAreaRect(ring) {
  const h = hull(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const [x0, z0] = h[i], [x1, z1] = h[(i + 1) % h.length];
    if (Math.hypot(x1 - x0, z1 - z0) < 0.5) continue;
    let ang = Math.atan2(-(z1 - z0), x1 - x0); // the edge as the local +u axis (cos ang, -sin ang)
    ang -= Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (ang <= -Math.PI / 4 + 1e-9) ang += Math.PI / 2;
    const b = turnedBox(h, ang);
    if (!best || b.w * b.d < best.w * best.d - 1e-6) best = { ...b, ang };
  }
  return best;
}

const lmElements = load('poz_landmarks.json').elements;
const lmIndex = new Map(lmElements.map((e) => [`${e.type}/${e.id}`, e]));
// Every name the query asks for must still name an element: an OSM rename silently drops a landmark (js/landmarks.js
// fitToSite skips a missing site), so the build says which names matched nothing
const lmNames = new Set(lmElements.map((e) => e.tags?.name).filter(Boolean));
for (const m of loadText('q_poz_landmarks.overpassql').matchAll(/\["name"(~|=)"(.*?)"\]/g)) {
  const names = m[1] === '=' ? [m[2]] : m[2].replace(/^\^\(|\)\$$/g, '').split('|');
  for (const n of names.map((q) => q.replace(/\\\\(.)/g, '$1'))) {
    if (!lmNames.has(n)) log(`WARNING landmark query name "${n}" matches nothing in poz_landmarks.json`);
  }
}
const landmarks = {};
for (const [key, ids] of Object.entries(LANDMARK_ELEMENTS)) {
  let pick = null;
  for (const id of ids) {
    const e = lmIndex.get(id);
    if (!e) { log(`landmark ${key}: ${id} missing from poz_landmarks.json`); continue; }
    let ring;
    if (e.type === 'node') {
      const [x, z] = toWorld(e.lon, e.lat), s = NODE_SIDE / 2;
      ring = [[x - s, z - s], [x - s, z + s], [x + s, z + s], [x + s, z - s]];
    } else {
      ring = outerInner(e).outer.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
      if (!ring) continue;
      if (Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.01) ring = ring.slice(0, -1);
    }
    const area = Math.abs(ringArea(ring));
    if (!pick || area > pick.area) pick = { id, e, ring, area };
  }
  if (!pick) continue;
  const t = pick.e.tags || {};
  const levels = parseFloat(t['building:levels']) || 0;
  const osmH = parseFloat(t.height) || 0;
  let h, src;
  if (LANDMARK_H[key]) {
    h = LANDMARK_H[key];
    src = osmH ? `curated (OSM height ${osmH} overridden)` : 'curated';
  } else if (osmH && osmH >= Math.max(6, levels * LEVEL_H)) {
    // OSM height only when it is at least the storeys' height: Brama Poznania's 5 (3 storeys) and Teatr Wielki's 1
    // fail this and fall through to their levels
    h = osmH;
    src = 'OSM height';
  } else if (levels) {
    h = Math.round(levels * LEVEL_H * 10) / 10;
    src = osmH ? `levels ${levels} × ${LEVEL_H} (OSM height ${osmH} rejected)` : `levels ${levels} × ${LEVEL_H}`;
  } else {
    h = DEFAULT_H;
    src = 'default';
  }
  const box = minAreaRect(pick.ring);
  const ring = cleanRing(pick.ring, 0.4);
  landmarks[key] = {
    x: r1(box.x), z: r1(box.z), w: r1(box.w), d: r1(box.d), h, area: Math.round(pick.area), ring: flat(ring),
    ang: Math.round(box.ang * 1e4) / 1e4
  };
  log(`landmark ${key}: ${pick.id}, ${landmarks[key].w} × ${landmarks[key].d} m at (${landmarks[key].x}, ${landmarks[key].z}), ang ${((box.ang * 180) / Math.PI).toFixed(1)}°, h ${h} (${src})`);
}
log(`${Object.keys(landmarks).length} landmarks, ${(JSON.stringify(landmarks).length / 1024).toFixed(0)} KB`);

// ---------------------------------------------------------------------------------------------------------------------
// Districts (osiedla) and place labels
// ---------------------------------------------------------------------------------------------------------------------
// admin_level 9 is the 42 osiedla that tile the city (Stare Miasto, Jeżyce, Wilda, Łazarz, Ostrów Tumski-Śródka-
// Zawady-Komandoria, ...); level 10 (81) and 11 (18) only subdivide some of them, mostly the outer ones
const admin = load('poz_admin.json').elements;
const AREA_PAD = 1000;
const districts = [];
for (const e of admin) {
  const t = e.tags || {};
  if (e.type !== 'relation' || t.admin_level !== '9' || !t.name) continue;
  const rings = outerInner(e).outer.filter((r) => Math.abs(ringArea(r)) > 1000);
  if (!rings.length) continue;
  // the main outer ring (an osiedle split by the city edge keeps only its largest piece)
  const ring = rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  if (!bbHitsBox(bbox(ring), AREA_PAD)) continue;
  districts.push({ name: t.name, ring: flat(cleanRing(ring, 5)) });
}
districts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
log(`districts: ${districts.length} osiedla (admin_level 9) within ${AREA_PAD} m of the detail box, ${(JSON.stringify(districts).length / 1024).toFixed(0)} KB: ${districts.map((d) => d.name).join(', ')}`);

// place=suburb / quarter / neighbourhood: nodes at their position, relations at their outer ring's centroid. The 26
// place=neighbourhood ways are developers' housing estates ("Apartamenty Dmowskiego", "Osiedle Wilczak 18, Serbska
// 4A-16D", "Murapol Osiedle Verde"), not map names, so ways are skipped. One label per name, the broadest kind first
// (a suburb's node over its neighbourhood's), then element order.
const KIND_RANK = { suburb: 0, quarter: 1, neighbourhood: 2 };
const placeCands = [];
for (const e of admin) {
  const t = e.tags || {};
  if (!(t.place in KIND_RANK) || !t.name || e.type === 'way') continue;
  let p;
  if (e.type === 'node') p = toWorld(e.lon, e.lat);
  else {
    const r = outerInner(e).outer.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    if (!r) continue;
    p = centroid(r);
  }
  if (!inDetailBox(p[0], p[1], AREA_PAD)) continue;
  placeCands.push({ name: t.name, kind: t.place, x: r1(p[0]), z: r1(p[1]), rank: KIND_RANK[t.place] + (e.type === 'node' ? 0 : 0.5) });
}
const labelBy = new Map();
for (const c of placeCands) {
  const prev = labelBy.get(c.name);
  if (!prev || c.rank < prev.rank) labelBy.set(c.name, c);
}
const labels = [...labelBy.values()].map(({ name, kind, x, z }) => ({ name, kind, x, z }));
const osmLabels = labels.length;
// Hand-placed names OSM has no place element for (Śródmieście, Chwaliszewo, Cytadela, Malta; poz_places.json), after
// the OSM ones so an OSM place of the same name wins. Centrum is left out: it names the same city centre as
// Śródmieście, so the two would sit on top of each other (and of Stare Miasto).
for (const p of load('poz_places.json').places) {
  if (labelBy.has(p.name) || !(p.kind in KIND_RANK)) continue;
  const [x, z] = toWorld(p.lon, p.lat);
  labels.push({ name: p.name, kind: p.kind, x: r1(x), z: r1(z) });
}
{
  const n = (k) => labels.filter((l) => l.kind === k).length;
  log(`labels: ${labels.length} places within ${AREA_PAD} m of the detail box (${n('suburb')} suburb, ${n('quarter')} quarter, ${n('neighbourhood')} neighbourhood; ${placeCands.length - osmLabels} duplicates dropped, ${labels.length - osmLabels} hand-placed)`);
}

export { parks, parkRings, coverParks, parkCellsByLabel, parkCoverage, landmarks, districts, labels };
