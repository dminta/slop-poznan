// tools/build-poznan.mjs — writes js/geodata.js, the Poznań GEO (docs/poznan-plan.md §2, §4; frame and inputs in
// poz-base.mjs, geometry and raster helpers in geo-util.mjs). Pass a path to write elsewhere (diff before replacing).
// usage: node --max-old-space-size=8192 tools/build-poznan.mjs [out.js]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log, llAffine, LAT0, LON0, BEARING_DEG, DETAIL_BOX, inDetailBox } from './poz-base.mjs';
import { r1, Raster } from './geo-util.mjs';
import { pieces, plazas, rail, roads, signalNodes, tramRoutes, tramStops } from './poz-roads.mjs';
import { water, land, landHoles, outskirts, outskirtsHoles } from './poz-water.mjs';
import { parks, landmarks, districts, labels } from './poz-extra.mjs';
import { blocks, STRIP, SIDEWALK } from './poz-blocks.mjs';
import { blockStats } from './poz-buildings.mjs';
import { buildRoadGraph } from './poz-roadgraph.mjs';

const OUT = process.argv[2] || fileURLToPath(new URL('../js/geodata.js', import.meta.url));
const q = r1;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);
const [BX0, BX1, BZ0, BZ1] = DETAIL_BOX;

// --- Water labels: the point deepest inside each named water body, within the detail box --------------------------
// 4 m raster over the body's rings clipped to the box, the cell farthest from the shore wins (first in scan order on a
// tie). Jezioro Maltańskie runs past the box's east edge, so its label sits on the box's part of the lake.
const WATER_LABELS = ['Warta', 'Cybina', 'Jezioro Maltańskie', 'Stare koryto Warty'];
const waterLabels = [];
for (const name of WATER_LABELS) {
  const bodies = water.filter((w) => w.name === name);
  if (!bodies.length) { log(`water label ${name}: no polygon`); continue; }
  const xs = bodies.flatMap((b) => b.ring.map((p) => p[0])), zs = bodies.flatMap((b) => b.ring.map((p) => p[1]));
  const ras = new Raster(Math.max(BX0, Math.min(...xs)) - 8, Math.max(BZ0, Math.min(...zs)) - 8,
    Math.min(BX1, Math.max(...xs)) + 8, Math.min(BZ1, Math.max(...zs)) + 8, 4);
  for (const b of bodies) {
    ras.fillRing(b.ring, 1);
    for (const h of b.holes || []) ras.fillRing(h, 0);
  }
  for (let j = 0; j < ras.h; j++) {
    for (let i = 0; i < ras.w; i++) {
      const x = ras.x0 + (i + 0.5) * ras.res, z = ras.z0 + (j + 0.5) * ras.res;
      if (x < BX0 || x > BX1 || z < BZ0 || z > BZ1) ras.d[j * ras.w + i] = 0;
    }
  }
  const dist = ras.edt((v) => v === 0);
  let best = -1, bk = -1;
  for (let k = 0; k < dist.length; k++) if (ras.d[k] && dist[k] > best) { best = dist[k]; bk = k; }
  if (bk < 0) { log(`water label ${name}: outside the detail box`); continue; }
  const i = bk % ras.w, j = (bk - i) / ras.w;
  waterLabels.push({ name, kind: 'water', x: q(ras.x0 + (i + 0.5) * ras.res), z: q(ras.z0 + (j + 0.5) * ras.res) });
}
log(`water labels: ${waterLabels.map((l) => `${l.name} (${l.x}, ${l.z})`).join(', ')}`);

const roadGraph = buildRoadGraph(pieces, signalNodes);

const GEO = {
  version: 2,
  frame: {
    bearingDeg: BEARING_DEG, origin: 'Ratusz, Stary Rynek', lat0: LAT0, lon0: LON0, units: 'm', strip: STRIP,
    sidewalk: SIDEWALK, detailBox: DETAIL_BOX.map(q), ll: llAffine()
  },
  // Land components inside the detail box (west bank, east bank and Śródka, Ostrów Tumski), largest first, negative
  // winding. landHoles: [{ outer: index into land, ring }] water fully enclosed by that component (ponds), positive
  // winding. Holes are a separate key rather than nested so `land` stays a plain [flatRing] as in the §2 contract.
  land: land.map(flat),
  landHoles: landHoles.map((h) => ({ outer: h.outer, ring: flat(h.ring) })),
  // [{ name, kind: 'river'|'lake'|'canal'|'pond', ring, holes? }]; holes are islands in the water, positive winding
  water: water.map((w) => (w.holes ? { name: w.name, kind: w.kind, ring: flat(w.ring), holes: w.holes.map(flat) } : { name: w.name, kind: w.kind, ring: flat(w.ring) })),
  // Low-detail land between the detail box and the city boundary, cut along the box edges (no ring has the box as a
  // hole); outskirtsHoles: [{ outer, ring }] lakes inside outskirts[outer]
  outskirts: outskirts.map(flat),
  outskirtsHoles: outskirtsHoles.map((h) => ({ outer: h.outer, ring: flat(h.ring) })),
  districts,
  labels: labels.concat(waterLabels),
  streets: [],
  avenues: [],
  // [name, curb-to-curb width, direction (1 one-way along the points, 0 both), lanes, motorway/trunk, flatPts]
  roads,
  // nodes [x, z, ...], links [a, b, name index, width, lanes, dir (1 a -> b, -1 b -> a, 0 both), inner points [x, z, ...],
  // flags (bit 0 bridge, bit 1 tram on street, bit 2 roundabout, bits 3/4 a painted bike lane right/left of a -> b),
  // speed limit km/h], names, signals [node index]
  roadGraph,
  // [{ kind: 'tram'|'rail', street (1 street-running), tracks, oneway (1: runs along pts), pts, routes (tram only) }]; cut
  // at every switch and crossing, so the tram network joins on equal end coordinates. routes: indices into tramRoutes of
  // the lines using the track
  rail: rail.map((r) => (r.routes
    ? { kind: r.kind, street: r.street, tracks: r.tracks, oneway: r.oneway, pts: flat(r.pts), routes: r.routes }
    : { kind: r.kind, street: r.street, tracks: r.tracks, oneway: r.oneway, pts: flat(r.pts) })),
  // [{ ref, from, to }] tram line routes (OSM route=tram, PTv2, one per direction): line number, first and last stop
  tramRoutes: tramRoutes.map((r) => ({ ref: r.ref, from: r.from, to: r.to })),
  // [{ name, x, z }] railway=tram_stop nodes inside the detail box (one per stop position, usually on the track)
  tramStops: tramStops.filter((s) => inDetailBox(s.x, s.z, 0)),
  // [{ name, ring, holes? }] pedestrian areas and squares; holes are the buildings standing on them (Stary Rynek's
  // central block), which the block raster gives back as blocks
  plazas: plazas.map((p) => (p.holes ? { name: p.name, ring: flat(p.ring), holes: p.holes.map(flat) } : { name: p.name, ring: flat(p.ring) })),
  // [outline, lot rects, park share, park name, rectangular, frontage frames [[θ, px, pz, lot rects in the frame], ...] | 0]
  blocks: blocks.map((b) => [flat(b.poly), b.rects.map((r) => r.map(q)), b.park || 0, b.parkName || '', b.rect ? 1 : 0,
    b.frames ? b.frames.map(([th, px, pz, rs]) => [Math.round(th * 1e4) / 1e4, q(px), q(pz), rs.map((r) => r.map(q))]) : 0]),
  // One per blocks entry, same order: [built share of the curb island under OSM building footprints (0..1), area-weighted
  // median building:levels of the buildings centred in it (0 if none tagged), building count] (poz-buildings.mjs)
  blockStats,
  parks,
  // { name: { x, z, w, d, h, area, ring, ang } }: w and d along the turned axes (ang, radians)
  landmarks
};

const json = JSON.stringify(GEO);
const header = `// js/geodata.js — GENERATED by tools/build-poznan.mjs, do not edit by hand.
// Real Poznań geography in the simulation's world frame: 1 unit = 1 m, x = east, z = south (north = -z), origin at the
// Ratusz on Stary Rynek (${LAT0} N, ${LON0} E), axes not turned (bearing ${BEARING_DEG}°).
// Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.
// Sources: © OpenStreetMap contributors (ODbL), via Overpass snapshots in tools/data/poz_*.json.
`;
fs.writeFileSync(OUT, `${header}export const GEO = ${json};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) in ${process.uptime().toFixed(1)} s`);
const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? (v.links ? v.links.length : Object.keys(v).length) : '');
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB${count(v) !== '' ? `, ${count(v)}` : ''}`);
