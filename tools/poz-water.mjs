// tools/poz-water.mjs — land and water for the Poznań build (docs/poznan-plan.md D3, D6, §4.2). Poznań is not an island:
// the Warta (with Ostrów Tumski between its arms), the Cybina, the Stare koryto Warty and Jezioro Maltańskie cut the
// core into several land pieces, so land is traced from a raster as every component above a size floor, not just the
// largest one.
//
// Input: tools/data/poz_water.json (natural=water incl. untagged ponds, waterway=riverbank, waterway=river|stream|canal
// centrelines, relation 7550595 Malta), tools/data/poz_admin.json (relation 165941, the admin_level=8 city boundary).
//
// Exports (world metres, x = east, z = south; every ring is an open [[x, z], ...] list rounded to 0.1 m):
// - water: [{ name, kind: 'river'|'lake'|'canal'|'pond', ring, holes? }] — the water polygons whose bbox reaches the
//   detail box padded by WATER_PAD, rdp-simplified at 1 m, negative shoelace winding (as land and plazas). A multipolygon
//   gives one entry per outer ring; its inner rings (islands in the water) above WATER_MIN_M2 go in `holes`, wound
//   positive. Unnamed river polygons take the name of the waterway centreline running inside them (way 27942106 → Warta).
// - waterRings: the same water as raw (unsimplified) outer rings, for burning water cells; islands are not in it, so use
//   isLandAt where an island matters (Malta's islets are all below the land floor anyway).
// - land: land components inside the detail box (box minus water on a 2 m raster), negative winding, largest first.
// - landHoles: [{ outer, ring }] — water fully enclosed by land component `land[outer]` (ponds), positive winding.
// - outskirts: low-detail land between the detail box and the city boundary, minus water, negative winding. The box is
//   not a hole: the ring around it is cut along x = box west / east edge into four pieces (west, east, and north / south
//   of the box), each traced on its own, so every piece is a plain outer ring that ends exactly on the box edge (snapped)
//   and the detail land fills the gap. The river splits pieces further.
// - outskirtsHoles: [{ outer, ring }] — lakes fully inside an outskirts piece (Rusałka, Strzeszyńskie, ...), positive.
// - isLandAt(x, z): the 2 m land raster behind `land` (false outside the detail box); LAND_RES its cell size.
import { load, log, toWorld, DETAIL_BOX } from './poz-base.mjs';
import { r1, ringArea, bbox, rdpRing, pointInRing, Raster, elemRings, labelComponents, traceComponents } from './geo-util.mjs';

const T0 = Date.now();
const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;

const LAND_RES = 2;
const WATER_PAD = 100; // water polygons reaching this close to the box are emitted (and burned)
const WATER_MIN_M2 = 200; // smaller natural=water is decoration (birdbaths, fountain basins without amenity=fountain)
const LAND_MIN_M2 = 5000; // smaller land is a pier head or a channel islet; Ostrów Tumski is ≈ 0.3 km²
const HOLE_MIN_M2 = 200; // matches WATER_MIN_M2, so every burned pond inside land becomes a hole
const OUT_RES = 10;
const OUT_MIN_M2 = 20000;
const OUT_HOLE_MIN_M2 = 10000;
const OUT_EPS = 6;

// ---------------------------------------------------------------------------------------------------------------------
// Water polygons
// ---------------------------------------------------------------------------------------------------------------------
const osm = load('poz_water.json');
const open = (r) => {
  // elemRings returns closed geometry (last = first); outputs are open rings
  const n = r.length;
  return n > 1 && r[0][0] === r[n - 1][0] && r[0][1] === r[n - 1][1] ? r.slice(0, -1) : r;
};
const kindOf = (t, area) => {
  if (t.waterway === 'riverbank' || t.water === 'river' || t.water === 'oxbow') return 'river';
  if (t.water === 'canal') return 'canal';
  if (t.water === 'lake') return 'lake';
  return area > 50000 ? 'lake' : 'pond';
};
const polys = [];
let fountains = 0, tiny = 0, openChains = 0;
for (const e of osm.elements) {
  const t = e.tags || {};
  if (t.natural !== 'water' && t.waterway !== 'riverbank') continue;
  // Fountain basins and wells are tagged natural=water too (Fontanna Wolności, Studnia Bamberki): street furniture
  if (t.amenity === 'fountain' || t.man_made === 'water_well' || t.tunnel || t.covered === 'yes') { fountains++; continue; }
  if (e.type === 'way' && !(e.geometry && e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1])) continue;
  const outers = elemRings(e, toWorld);
  const inners = e.type === 'relation'
    ? elemRings({ type: 'relation', members: (e.members || []).filter((m) => m.role === 'inner').map((m) => ({ ...m, role: 'outer' })) }, toWorld)
    : [];
  for (const r of [...outers, ...inners]) if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 1) openChains++;
  for (const outer of outers.map(open)) {
    const area = Math.abs(ringArea(outer));
    if (area < WATER_MIN_M2) { tiny++; continue; }
    const holes = inners.map(open).filter((h) => Math.abs(ringArea(h)) >= WATER_MIN_M2 && pointInRing(h[0][0], h[0][1], outer));
    polys.push({ id: `${e.type[0]}${e.id}`, name: t.name || '', kind: kindOf(t, area), area, outer, holes, bb: bbox(outer) });
  }
}
log(`water: ${polys.length} polygons ≥ ${WATER_MIN_M2} m² city-wide (${tiny} smaller and ${fountains} fountains/wells/covered dropped${openChains ? `, ${openChains} unclosed chains` : ''})`);

// Name unnamed river polygons by the waterway centrelines inside them, weighted by length (culverts excluded)
const lines = osm.elements.filter((e) => e.type === 'way' && e.geometry && /^(river|canal|stream)$/.test((e.tags || {}).waterway || '') && (e.tags || {}).name && !(e.tags || {}).tunnel);
for (const p of polys) {
  if (p.name || (p.kind !== 'river' && p.kind !== 'canal')) continue;
  const len = new Map();
  for (const l of lines) {
    const b = l.bounds;
    const pts = l.geometry.map((g) => toWorld(g.lon, g.lat));
    const lb = bbox(pts);
    if (!b || lb.x1 < p.bb.x0 || lb.x0 > p.bb.x1 || lb.z1 < p.bb.z0 || lb.z0 > p.bb.z1) continue;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2, mz = (pts[i - 1][1] + pts[i][1]) / 2;
      if (pointInRing(mx, mz, p.outer)) len.set(l.tags.name, (len.get(l.tags.name) || 0) + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
  }
  let best = '', bl = 0;
  for (const [n, l] of [...len].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (l > bl) { best = n; bl = l; }
  if (bl >= 30) p.name = best;
}

const nearBox = (bb, pad) => bb.x1 >= BX0 - pad && bb.x0 <= BX1 + pad && bb.z1 >= BZ0 - pad && bb.z0 <= BZ1 + pad;
// Water drawn inside other water is dropped (the Malta fountain safety zone, way 350540382, sits in the lake)
const inWater = (p, q) => q.area > p.area && p.bb.x0 >= q.bb.x0 && p.bb.x1 <= q.bb.x1 && p.bb.z0 >= q.bb.z0 && p.bb.z1 <= q.bb.z1 &&
  p.outer.every(([x, z]) => pointInRing(x, z, q.outer) && !q.holes.some((h) => pointInRing(x, z, h)));
const nearPolys = polys.filter((p) => nearBox(p.bb, WATER_PAD));
const detailPolys = nearPolys.filter((p) => !nearPolys.some((q) => q !== p && inWater(p, q))).sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1));
const simplify = (r, eps, sign) => {
  const s = rdpRing(r, eps).map(([x, z]) => [r1(x), r1(z)]);
  if (Math.sign(ringArea(s)) !== sign) s.reverse();
  return s;
};
const water = detailPolys.map((p) => {
  const w = { name: p.name, kind: p.kind, ring: simplify(p.outer, 1, -1) };
  if (p.holes.length) w.holes = p.holes.map((h) => simplify(h, 1, 1));
  return w;
});
const waterRings = detailPolys.map((p) => p.outer);
{
  const byKind = {};
  for (const p of detailPolys) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  const named = detailPolys.filter((p) => p.name).map((p) => `${p.name} ${(p.area / 1e4).toFixed(1)} ha`);
  log(`water near the detail box: ${detailPolys.length} (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}); named: ${named.join(', ')}`);
}

// Even-odd fill of a polygon with holes: the rings joined into one by keyhole edges, each walked there and back, so they
// cancel in the crossing count (fillRing takes one ring)
function fillPolygon(ras, outer, holes, val) {
  if (!holes.length) { ras.fillRing(outer, val); return; }
  const all = [];
  for (const r of [outer, ...holes]) all.push(...r, r[0]);
  all.push(outer[0]);
  ras.fillRing(all, val);
}
// Snap coordinates within `tol` of the box edge lines onto them: rasters are grid-aligned, the box is not
const snapBox = (r, tol) => r.map(([x, z]) => [
  Math.abs(x - BX0) < tol ? BX0 : Math.abs(x - BX1) < tol ? BX1 : x,
  Math.abs(z - BZ0) < tol ? BZ0 : Math.abs(z - BZ1) < tol ? BZ1 : z
]);
const cellArea = (res) => res * res;

// ---------------------------------------------------------------------------------------------------------------------
// Land in the detail box: 2 m raster padded by 40 m of land beyond the box (so open/close don't round the box corners
// or eat the strips along its edges), water burned to 0, then the padding cut off before tracing
// ---------------------------------------------------------------------------------------------------------------------
const LP = 40;
const L = new Raster(BX0 - LP, BZ0 - LP, BX1 + LP, BZ1 + LP, LAND_RES);
L.d.fill(1);
for (const p of detailPolys) fillPolygon(L, p.outer, p.holes, 0);
// 3 m: drops land slivers under 6 m between overlapping river polygons (27942106 vs 27949570 leave 1-cell seams) and
// fills water gaps under 6 m, while the 10–20 m Chwaliszewo and Wybrzeże Wiadrowe embankment strips survive
L.open(3);
L.close(3);
for (let j = 0; j < L.h; j++) {
  const z = L.z0 + (j + 0.5) * LAND_RES;
  for (let i = 0; i < L.w; i++) {
    const x = L.x0 + (i + 0.5) * LAND_RES;
    if (x < BX0 || x > BX1 || z < BZ0 || z > BZ1) L.d[j * L.w + i] = 0;
  }
}
const landAll = labelComponents(L, (v) => v !== 0);
const landTrace = traceComponents(L, {
  minCells: LAND_MIN_M2 / cellArea(LAND_RES),
  minHoleCells: HOLE_MIN_M2 / cellArea(LAND_RES)
});
const land = [];
const landHoles = [];
for (const c of landTrace.components) {
  const k = land.length;
  land.push(simplify(snapBox(c.ring, LAND_RES * 0.75), 1, -1));
  for (const h of c.holes) landHoles.push({ outer: k, ring: simplify(h.ring, 1, 1) });
}
{
  let dropped = 0, droppedM2 = 0;
  for (let id = 1; id < landAll.cells.length; id++) {
    if (landAll.cells[id] < LAND_MIN_M2 / cellArea(LAND_RES)) { dropped++; droppedM2 += landAll.cells[id] * cellArea(LAND_RES); }
  }
  log(`land: ${land.length} components (${land.map((r, k) => `${(Math.abs(ringArea(r)) / 1e6).toFixed(3)} km² ${r.length} pts${landTrace.components[k].holes.length ? ` ${landTrace.components[k].holes.length} holes` : ''}`).join('; ')}); dropped ${dropped} under ${LAND_MIN_M2} m² (${droppedM2} m² total)`);
}
const LAND_LAB = landTrace.labels;
function isLandAt(x, z) {
  if (x < BX0 || x > BX1 || z < BZ0 || z > BZ1) return false;
  const i = Math.floor((x - L.x0) / LAND_RES), j = Math.floor((z - L.z0) / LAND_RES);
  return i >= 0 && j >= 0 && i < L.w && j < L.h && LAND_LAB[j * L.w + i] !== 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Outskirts: city boundary minus all water on a 10 m raster, the detail box cut out, split in four pieces around it
// ---------------------------------------------------------------------------------------------------------------------
const admin = load('poz_admin.json');
const city = admin.elements.find((e) => e.type === 'relation' && e.id === 165941);
const cityRings = elemRings(city, toWorld);
const cbb = bbox(cityRings.flat());
const O = new Raster(cbb.x0 - 3 * OUT_RES, cbb.z0 - 3 * OUT_RES, cbb.x1 + 3 * OUT_RES, cbb.z1 + 3 * OUT_RES, OUT_RES);
for (const r of cityRings) O.fillRing(r, 1);
for (const p of polys) fillPolygon(O, p.outer, p.holes, 0);
O.open(10); // land necks under 20 m (dykes between ponds, the boundary's own slivers)
O.close(10); // streams and ditches under 20 m wide
const pieces = [[], [], [], []]; // west, east, north, south of the box
for (let j = 0; j < O.h; j++) {
  const z = O.z0 + (j + 0.5) * OUT_RES;
  for (let i = 0; i < O.w; i++) {
    const p = j * O.w + i;
    if (!O.d[p]) continue;
    const x = O.x0 + (i + 0.5) * OUT_RES;
    if (x < BX0) pieces[0].push(p);
    else if (x > BX1) pieces[1].push(p);
    else if (z < BZ0) pieces[2].push(p);
    else if (z > BZ1) pieces[3].push(p);
  }
}
const outskirts = [];
const outskirtsHoles = [];
for (const cells of pieces) {
  O.d.fill(0);
  for (const p of cells) O.d[p] = 1;
  const t = traceComponents(O, { minCells: OUT_MIN_M2 / cellArea(OUT_RES), minHoleCells: OUT_HOLE_MIN_M2 / cellArea(OUT_RES) });
  for (const c of t.components) {
    const k = outskirts.length;
    outskirts.push(simplify(snapBox(c.ring, OUT_RES * 0.75), OUT_EPS, -1));
    for (const h of c.holes) outskirtsHoles.push({ outer: k, ring: simplify(h.ring, OUT_EPS, 1) });
  }
}
{
  const verts = outskirts.reduce((t, r) => t + r.length, 0) + outskirtsHoles.reduce((t, h) => t + h.ring.length, 0);
  const km2 = outskirts.reduce((t, r) => t + Math.abs(ringArea(r)), 0) - outskirtsHoles.reduce((t, h) => t + Math.abs(ringArea(h.ring)), 0);
  log(`outskirts: ${outskirts.length} rings, ${outskirtsHoles.length} holes, ${verts} vertices, ${(km2 / 1e6).toFixed(1)} km² (city ${(cityRings.reduce((t, r) => t + Math.abs(ringArea(r)), 0) / 1e6).toFixed(1)} km²)`);
}
log(`poz-water: ${Date.now() - T0} ms`);

export { water, waterRings, land, landHoles, outskirts, outskirtsHoles, isLandAt, LAND_RES };
