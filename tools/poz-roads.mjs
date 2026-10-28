// tools/poz-roads.mjs — OSM highways, rails and squares → road pieces, plazas, rail lines and the merged GEO.roads
// polylines, in the Poznań frame (poz-base.mjs). Work happens at import time, like the other poz-*.mjs modules.
//
// OSM ways are not split at junctions: a way runs through many junctions, and a junction is any node two drivable
// ways share. Every way is cut at those nodes (and at its own repeated nodes), so each piece runs junction to junction
// and its end node ids give the road graph its topology (poz-roadgraph.mjs) without guessing from coordinates.
//
// Exports (world metres, x east, z south):
//   pieces:         [{ id, wayId, name, cls, w, lanes, dir, bridge, tram, roundabout, kmh, kmhTagged, pts: [[x, z]...],
//                   nodes: [osmId...], tramSide }]; kmh: the speed limit (km/h), kmhTagged: 1 when OSM states it (speedLimit);
//                   tramSide: +1 / -1 the TRAM_W tram strip in w lies right / left of the points (tracks beside the
//                   carriageway), 0 centred on them;
//                   at-grade drivable pieces touching DETAIL_BOX + PIECE_PAD (tunnels and layer < 0 dropped, except railway
//                   underpasses, which stay at grade)
//   plazas:         [{ name, ring: [[x, z]...], holes? }] pedestrian areas and squares, negative shoelace winding;
//                   holes: a multipolygon's inner rings of PLAZA_HOLE_M2 and up (buildings on the square), positive
//   pedestrianWays: [{ name, w, pts }] linear highway=pedestrian streets (Półwiejska, Stary Rynek's lanes)
//   rail:           [{ kind: 'tram'|'rail', street: 0|1, tracks, oneway: 0|1, pts, routes? }] chained OSM track pieces (one entry
//                   per mapped track, cut at switches and crossings; a one-way track runs along its points)
//   railCorridors:  { rings: [ring...], lines: [{ pts, w }] } landuse=railway areas and off-street tracks (non-buildable)
//   levelCrossings: [[x, z]...] nodes a drivable piece shares with a mainline (railway=rail|light_rail) track way,
//                   inside the detail box: the level crossings (OSM puts railway=level_crossing on that shared node)
//   roads:          GEO.roads tuples [name, w, dir, lanes, hw, flatPts]
//   tramRoutes:     [{ ref, from, to, id, ways: Set }] the day lines' route=tram relations (one per direction); tram
//                   rail entries carry `routes`, the indices of the routes using them
//   tramStops:      [{ name, x, z }]
//   signalNodes:    [{ id, x, z, crossing }] highway=traffic_signals nodes (crossing: a pedestrian-crossing signal)
import { load, log, toWorld, DETAIL_BOX, inDetailBox } from './poz-base.mjs';
import { r1, ringArea, rdp, rdpRing, pointInRing, elemRings } from './geo-util.mjs';

const PIECE_PAD = 200; // m around the detail box: pieces reaching into it are kept whole, the block raster clips
const ROADS_PAD = 100; // m: GEO.roads keeps pieces whose midpoint is this close to the box
const PLAZA_HOLE_M2 = 100; // m²: smaller inner rings of a pedestrian area are street furniture

const osmRoads = load('poz_roads.json');
const osmRail = load('poz_rail.json');
const osmPoints = load('poz_signals.json');
const osmTramRoutes = load('poz_tram_routes.json');

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'road', 'busway', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
  'tertiary_link']);
const EXCLUDED_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through']);
// Class defaults (plan §4.2). Only 1.3% of the core's car roads carry `width` and 68% `lanes`, so these decide most
// widths. A one-way carriageway of a dual road (Królowej Jadwigi, Garbary) without tags gets 0.55× the two-way width.
const CLASS_W = { motorway: 15, trunk: 15, primary: 15, secondary: 12, tertiary: 10, unclassified: 7.5, residential: 7.5,
  road: 7.5, living_street: 6, service: 5, busway: 6.5 };
const LINK_W = 6.5;
const LANE_W = 3.25;
const PARKING_W = 2.2;
const TRAM_W = 6.5; // two tracks at 1435 mm gauge with their clearance (plan §4.2)

const tagOf = (e) => e.tags || {};
const isOneway = (t) => {
  if (t.oneway === 'yes' || t.oneway === 'true' || t.oneway === '1') return 1;
  if (t.oneway === '-1' || t.oneway === 'reverse') return -1;
  if ((t.junction === 'roundabout' || t.junction === 'circular') && t.oneway !== 'no') return 1;
  return 0;
};
const baseCls = (cls) => cls.replace(/_link$/, '');
function defaultLanes(cls, dir) {
  const big = ['motorway', 'trunk', 'primary'].includes(baseCls(cls));
  if (/_link$/.test(cls)) return 1;
  return dir ? (big ? 2 : 1) : big ? 4 : 2;
}
// Parking sides from the current (parking:left|right|both) and the older (parking:lane:*) schemes
function parkingSides(t) {
  const on = (v) => v && !/^(no|none|separate|fire_lane|no_parking|no_stopping)$/.test(v);
  let n = 0;
  for (const pre of ['parking:', 'parking:lane:']) {
    if (on(t[pre + 'both'])) return 2;
    n = Math.max(n, (on(t[pre + 'left']) ? 1 : 0) + (on(t[pre + 'right']) ? 1 : 0));
  }
  return n;
}
function widthOf(t, cls, dir, lanes, lanesTagged) {
  const w = parseFloat(t.width);
  if (Number.isFinite(w) && w >= 2 && w <= 60) return { w, explicit: true };
  if (lanesTagged) return { w: lanes * LANE_W + PARKING_W * parkingSides(t), explicit: false };
  const d = /_link$/.test(cls) ? LINK_W : CLASS_W[cls] || 7.5;
  return { w: dir && !/_link$/.test(cls) ? Math.max(4, d * 0.55) : d, explicit: false };
}
const lineLen = (pts) => {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
};
// The point half way along a polyline
function midOf(pts) {
  const half = lineLen(pts) / 2;
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (s + L >= half && L > 0) {
      const t = (half - s) / L;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    s += L;
  }
  return pts[0];
}
const touchesBox = (pts, pad) => {
  const [x0, x1, z0, z1] = DETAIL_BOX;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
  return b >= x0 - pad && a <= x1 + pad && d >= z0 - pad && c <= z1 + pad;
};
// Speed limit in km/h. Inside a Polish built-up area the default is 50 (PL:urban) and 20 in a living street
// (strefa zamieszkania); 30/20 zones are signed, and OSM states them as `maxspeed` plus a `source:maxspeed` or
// `maxspeed:type` of PL:zone30. Measured on the 2026-10-25 snapshot: every `maxspeed` is a plain number (5-80), and 83%
// of the drivable ways other than service roads carry one; 27 ways tag only `maxspeed:forward`/`:backward`, which give
// the lower of the two here (a link carries one limit). Untagged ways fall back to the zone tag, then the class.
const ZONE_KMH = (v) => {
  if (!v) return 0;
  const m = /PL:zone(\d+)/.exec(v);
  if (m) return +m[1];
  if (/PL:living_street/.test(v)) return 20;
  return /PL:urban/.test(v) ? 50 : 0;
};
const CLASS_KMH = { living_street: 20, service: 20 };
function speedLimit(t, cls) {
  const tagged = parseInt(t.maxspeed, 10);
  if (tagged > 0) return { kmh: tagged, tagged: 1 };
  const dirs = [parseInt(t['maxspeed:forward'], 10), parseInt(t['maxspeed:backward'], 10)].filter((v) => v > 0);
  if (dirs.length) return { kmh: Math.min(...dirs), tagged: 1 };
  const zone = ZONE_KMH(t['zone:maxspeed']) || ZONE_KMH(t['maxspeed:type']) || ZONE_KMH(t['source:maxspeed']);
  return { kmh: zone || CLASS_KMH[cls] || 50, tagged: 0 };
}
const underground = (t) => (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') || parseFloat(t.layer) < 0;

// ---------------------------------------------------------------------------------------------------------------------
// Split drivable ways into junction-to-junction pieces
// ---------------------------------------------------------------------------------------------------------------------
const drivableWays = osmRoads.elements.filter((e) => {
  if (e.type !== 'way' || !e.geometry || !e.nodes) return false;
  const t = tagOf(e);
  if (!DRIVABLE.has(t.highway) || t.area === 'yes') return false;
  return !(t.highway === 'service' && EXCLUDED_SERVICE.has(t.service));
});
// Node use counts: distinct drivable ways through a node, tunnels included (a tunnel portal is still a junction)
const wayCount = new Map();
const splitAt = new Set();
for (const w of drivableWays) {
  const seen = new Set();
  for (const n of w.nodes) {
    if (seen.has(n)) { splitAt.add(n); continue; } // self-intersection, or a closed way's first node
    seen.add(n);
    const c = (wayCount.get(n) || 0) + 1;
    wayCount.set(n, c);
    if (c >= 2) splitAt.add(n);
  }
}

// Railway underpasses. OSM tags a road or tram track under a rail bridge tunnel=yes and/or layer=-1: Hetmańska under
// the Górczyn line (the eastbound carriageway and both tram tracks in one way each, the westbound carriageway in three),
// Nad Wierzbakiem and two service roads. The world is flat, so they stay at grade like any road, and tram-infra.js cuts
// the railway over them; dropped, Hetmańska had an 80 m gap with the trackbed running across it. An underpass is an
// underground way that crosses an at-grade railway=rail|light_rail way, plus the underground ways of the same name with
// an end within UNDERPASS_JOIN of one (Hetmańska's westbound pieces meet through a 4 m at-grade way). Other underground
// ways (car park ramps, courtyard passages, a road dipping under another road, the Franowo tram tunnel) are still
// dropped: drawn at grade they would cross roads they never meet.
const UNDERPASS_JOIN = 10; // m
function segCross(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
const bboxOf = (P) => P.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)],
  [Infinity, -Infinity, Infinity, -Infinity]);
const mainlineAtGrade = osmRail.elements.filter((e) => e.type === 'way' && e.geometry &&
  ['rail', 'light_rail'].includes(tagOf(e).railway) && !underground(tagOf(e)))
  .map((e) => { const P = e.geometry.map((g) => toWorld(g.lon, g.lat)); return { P, box: bboxOf(P) }; });
// The ids of the underground ways among `ways` (OSM ways with geometry) that pass under the railway
function railwayUnderpasses(ways) {
  const under = ways.filter((w) => underground(tagOf(w))).map((w) => {
    const P = w.geometry.map((g) => toWorld(g.lon, g.lat));
    return { w, P, box: bboxOf(P), name: tagOf(w).name || '' };
  });
  const ids = new Set();
  for (const u of under) {
    const [x0, x1, z0, z1] = u.box;
    const hit = mainlineAtGrade.some(({ P: Q, box: [a0, a1, c0, c1] }) => {
      if (a0 > x1 || a1 < x0 || c0 > z1 || c1 < z0) return false;
      for (let i = 0; i + 1 < u.P.length; i++) {
        for (let j = 0; j + 1 < Q.length; j++) if (segCross(u.P[i], u.P[i + 1], Q[j], Q[j + 1])) return true;
      }
      return false;
    });
    if (hit) ids.add(u.w.id);
  }
  const endsOf = (u) => [u.P[0], u.P[u.P.length - 1]];
  for (let grown = true; grown;) {
    grown = false;
    for (const u of under) {
      if (ids.has(u.w.id) || !u.name) continue;
      const joins = under.some((v) => ids.has(v.w.id) && v.name === u.name &&
        endsOf(u).some((a) => endsOf(v).some((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= UNDERPASS_JOIN)));
      if (joins) { ids.add(u.w.id); grown = true; }
    }
  }
  return ids;
}
const underpassWays = railwayUnderpasses(drivableWays);

const pieces = [];
let droppedUnder = 0;
for (const w of drivableWays) {
  const t = tagOf(w);
  if (underground(t) && !underpassWays.has(w.id)) { droppedUnder++; continue; }
  const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!touchesBox(pts, PIECE_PAD)) continue;
  const cls = t.highway;
  const dir = isOneway(t);
  const lanesTag = parseInt(t.lanes, 10);
  const lanesTagged = Number.isFinite(lanesTag) && lanesTag > 0;
  const lanes = lanesTagged ? lanesTag : defaultLanes(cls, dir);
  const { w: width, explicit } = widthOf(t, cls, dir, lanes, lanesTagged);
  const limit = speedLimit(t, cls);
  const base = {
    wayId: w.id, name: t.name || t.ref || '', cls, w: width, explicitW: explicit, lanes, dir,
    bridge: t.bridge && t.bridge !== 'no' ? 1 : 0, tram: 0,
    roundabout: t.junction === 'roundabout' || t.junction === 'circular' ? 1 : 0,
    kmh: limit.kmh, kmhTagged: limit.tagged
  };
  // Cut indices: the ends plus every split node in between
  const cuts = [0];
  for (let i = 1; i < w.nodes.length - 1; i++) if (splitAt.has(w.nodes[i])) cuts.push(i);
  cuts.push(w.nodes.length - 1);
  for (let k = 0; k + 1 < cuts.length; k++) {
    const i0 = cuts[k], i1 = cuts[k + 1];
    if (i1 <= i0) continue;
    // A piece that closes on itself (a roundabout way with one exit) would be a self-loop link: halve it
    const spans = w.nodes[i0] === w.nodes[i1] && i1 - i0 >= 2 ? [[i0, (i0 + i1) >> 1], [(i0 + i1) >> 1, i1]] : [[i0, i1]];
    for (const [a, b] of spans) {
      if (w.nodes[a] === w.nodes[b]) continue;
      const pp = pts.slice(a, b + 1);
      if (!touchesBox(pp, PIECE_PAD)) continue;
      pieces.push({ ...base, pts: pp, nodes: w.nodes.slice(a, b + 1) });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rails: tram/rail track ways, landuse=railway
// ---------------------------------------------------------------------------------------------------------------------
// Track ways of a route=tram relation count as tram track whatever their railway tag. A line closed for rebuilding is
// retagged railway=disused|razed|construction (no `disused:railway=tram`) but stays in its routes: in the 2026 data
// that is the whole Ostrów Tumski line (Pl. Wielkopolski - Most Chrobrego - Katedra - Most Mieszka I - Rondo Śródka),
// Most Teatralny and the Fredry curve. The snapshot was current; the filter on railway=tram dropped them.
const CLOSED_TRACK = new Set(['disused', 'razed', 'construction', 'abandoned']);
const routeWays = new Set();
for (const r of osmTramRoutes.elements) {
  if (r.type === 'relation' && tagOf(r).route === 'tram') for (const m of r.members) if (m.type === 'way') routeWays.add(m.ref);
}
const trackWays = [];
const trackUnderpasses = railwayUnderpasses(osmRail.elements.filter((e) => e.type === 'way' && e.geometry &&
  ['tram', 'rail', 'light_rail'].includes(tagOf(e).railway)));
let droppedRailTunnel = 0;
let closedTram = 0;
for (const e of osmRail.elements) {
  const t = tagOf(e);
  if (e.type !== 'way' || !e.geometry) continue;
  const closed = CLOSED_TRACK.has(t.railway) && routeWays.has(e.id);
  if (!closed && !['tram', 'rail', 'light_rail'].includes(t.railway)) continue;
  if (underground(t) && !trackUnderpasses.has(e.id)) { droppedRailTunnel++; continue; }
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!touchesBox(pts, PIECE_PAD)) continue;
  // oneway=-1 tracks are turned round so every one-way track runs along its points (85% of the tram ways carry oneway)
  const oneway = isOneway(t);
  const nodes = e.nodes.slice();
  if (oneway < 0) { pts.reverse(); nodes.reverse(); }
  if (closed) closedTram++;
  trackWays.push({ id: e.id, kind: t.railway === 'tram' || closed ? 'tram' : 'rail', tracks: parseInt(t.tracks, 10) || 1,
    oneway: oneway ? 1 : 0, bridge: t.bridge && t.bridge !== 'no' ? 1 : 0, pts, nodes });
}
// Track pieces for GEO.rail: every track way cut at the nodes it shares with another track way (switches, crossings),
// like the road pieces, so a chain end is a real junction and the runtime can join the tram network by end coordinates
const trackUse = new Map();
for (const t of trackWays) for (const n of new Set(t.nodes)) trackUse.set(n, (trackUse.get(n) || 0) + 1);
const trackPieces = [];
for (const t of trackWays) {
  let i0 = 0;
  for (let i = 1; i < t.nodes.length; i++) {
    if (i < t.nodes.length - 1 && trackUse.get(t.nodes[i]) < 2) continue;
    trackPieces.push({ way: t, pts: t.pts.slice(i0, i + 1), nodes: t.nodes.slice(i0, i + 1) });
    i0 = i;
  }
}

// Segment grid for "runs along" tests between road pieces and tram tracks
const GRID = 25;
function segGrid(lines) {
  const g = new Map();
  for (const pts of lines) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const seg = [ax, az, bx, bz, (bx - ax) / L, (bz - az) / L, L];
      for (let ix = Math.floor(Math.min(ax, bx) / GRID); ix <= Math.floor(Math.max(ax, bx) / GRID); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / GRID); iz <= Math.floor(Math.max(az, bz) / GRID); iz++) {
          const k = ix * 100003 + iz;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(seg);
        }
      }
    }
  }
  return g;
}
// Is there a segment within `maxD` of (x, z) running parallel (|cos| ≥ minCos) to (dx, dz)?
function nearParallel(g, x, z, dx, dz, maxD, minCos) {
  const ix = Math.floor(x / GRID), iz = Math.floor(z / GRID);
  for (let a = ix - 1; a <= ix + 1; a++) {
    for (let b = iz - 1; b <= iz + 1; b++) {
      for (const [ax, az, , , ux, uz, L] of g.get(a * 100003 + b) || []) {
        if (Math.abs(ux * dx + uz * dz) < minCos) continue;
        const s = Math.max(0, Math.min(L, (x - ax) * ux + (z - az) * uz));
        if (Math.hypot(ax + ux * s - x, az + uz * s - z) <= maxD) return true;
      }
    }
  }
  return false;
}
// Share of a polyline's 4 m samples (the ends kept 3 m clear, so a crossing junction does not count) passing the test
function shareAlong(pts, test) {
  const total = lineLen(pts);
  if (total < 0.5) return 0;
  const from = Math.min(3, total / 2);
  let n = 0, hit = 0, s0 = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = Math.max(from, Math.ceil((s0 - from) / 4) * 4 + from); s <= Math.min(s0 + L, total - from); s += 4) {
      n++;
      if (test(ax + ux * (s - s0), az + uz * (s - s0), ux, uz)) hit++;
    }
    s0 += L;
  }
  return n ? hit / n : 0;
}

// Tram on street. OSM maps each tram track as its own way, mostly without sharing nodes with the carriageway, so this is
// geometric: a road piece carries a tram when, over ≥ 60% of its length, a tram track runs within 12 m and within ~25°
// of parallel. 12 m reaches the tracks of a central reservation from either carriageway of a divided road (Królowej
// Jadwigi, Grunwaldzka: carriageway axis to track ≈ 6-10 m) without reaching tracks behind a building line. Service
// roads and links are left out: they run beside reservations (tram loops, depot yards) rather than carry the tracks.
// Such a piece is TRAM_W wider. Where the tracks run beside its carriageway rather than on it (the median of a divided
// road: Św. Marcin, Roosevelta, Królowej Jadwigi), the tram strip is added on their side only, `tramSide` +1 right or
// -1 left of the points' direction (0: tracks within the carriageway, the strip centred on it): the median signed
// offset of the nearest parallel track lies beyond the carriageway's half width. Centred on every piece, the strip put
// 3.25 m of roadway past the real outer curb, and the lanes looked shifted towards the tracks. Measured on the
// 2026-10-25 snapshot: 512 tram links beside their tracks (32.2 km), 154 with the tracks on them (6.3 km).
const TRAM_D = 12;
const TRAM_COS = 0.9;
const tramGrid = segGrid(trackWays.filter((t) => t.kind === 'tram').map((t) => t.pts));
// Median signed offset (right of the points' direction) of the nearest parallel track within TRAM_D, every 4 m
function trackOffset(pts) {
  const offs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = L / 2 % 4; s < L; s += 4) {
      const x = ax + ux * s, z = az + uz * s, ix = Math.floor(x / GRID), iz = Math.floor(z / GRID);
      let best = TRAM_D, off = null;
      for (let a = ix - 1; a <= ix + 1; a++) {
        for (let b = iz - 1; b <= iz + 1; b++) {
          for (const [sx, sz, , , vx, vz, SL] of tramGrid.get(a * 100003 + b) || []) {
            if (Math.abs(vx * ux + vz * uz) < TRAM_COS) continue;
            const t = Math.max(0, Math.min(SL, (x - sx) * vx + (z - sz) * vz));
            const qx = sx + vx * t - x, qz = sz + vz * t - z, d = Math.hypot(qx, qz);
            if (d < best) { best = d; off = qx * -uz + qz * ux; }
          }
        }
      }
      if (off !== null) offs.push(off);
    }
  }
  offs.sort((p, q) => p - q);
  return offs.length ? offs[offs.length >> 1] : 0;
}
for (const p of pieces) {
  p.tramSide = 0;
  if (p.cls === 'service' || /_link$/.test(p.cls)) continue;
  if (shareAlong(p.pts, (x, z, dx, dz) => nearParallel(tramGrid, x, z, dx, dz, TRAM_D, TRAM_COS)) >= 0.6) {
    p.tram = 1;
    if (p.explicitW) continue;
    const off = trackOffset(p.pts);
    if (Math.abs(off) > p.w / 2) p.tramSide = Math.sign(off);
    p.w += TRAM_W;
  }
}
for (const [i, p] of pieces.entries()) {
  p.id = i;
  p.w = r1(p.w);
  delete p.explicitW;
}
// A tram track is on street when a (non-service) road piece runs along it over ≥ 50% of its length: the same test the
// other way round. Tracks on their own right of way away from roads (the PST cutting's open stretches, loops, depots)
// stay street 0
const streetGrid = segGrid(pieces.filter((p) => p.cls !== 'service').map((p) => p.pts));
const onStreet = (pts) => shareAlong(pts, (x, z, dx, dz) => nearParallel(streetGrid, x, z, dx, dz, TRAM_D, TRAM_COS)) >= 0.5;

// Chain lines sharing end nodes into longer polylines. Items: { key, pts, nodes, directed, id? }. A chain grows through a
// node only where exactly two items of the same key meet, so junctions stay chain ends; undirected items are reversed as
// needed. Each chain lists the `id`s of its items. `stopAt` (optional): nodes no chain grows through whatever the keys
// (where more than two items of any key end). Deterministic: the walk follows item order.
function chainByNodes(items, stopAt = null) {
  const out = [];
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.key)) groups.set(it.key, []);
    groups.get(it.key).push(it);
  }
  const first = (it) => it.nodes[0];
  const last = (it) => it.nodes[it.nodes.length - 1];
  for (const [key, list] of groups) {
    const at = new Map(); // node -> item indices ending there
    const add = (n, i) => { if (!at.has(n)) at.set(n, []); at.get(n).push(i); };
    list.forEach((it, i) => { add(first(it), i); add(last(it), i); });
    const used = new Uint8Array(list.length);
    // The unused item continuing a chain through node n: only where exactly two item ends meet. `fwd`: growing at the
    // chain's tail, so a directed item must start at n (at the head, end at n)
    const step = (n, fwd) => {
      const c = at.get(n);
      if (c.length !== 2 || (stopAt && stopAt.has(n))) return -1;
      for (const k of c) {
        if (used[k]) continue;
        if (list[k].directed && (fwd ? first(list[k]) : last(list[k])) !== n) continue;
        return k;
      }
      return -1;
    };
    for (let i0 = 0; i0 < list.length; i0++) {
      if (used[i0]) continue;
      used[i0] = 1;
      let pts = list[i0].pts.slice();
      let nodes = list[i0].nodes.slice();
      const ids = [list[i0].id];
      for (let j; nodes[nodes.length - 1] !== nodes[0] && (j = step(nodes[nodes.length - 1], true)) >= 0;) {
        used[j] = 1;
        const it = list[j];
        const keep = first(it) === nodes[nodes.length - 1];
        ids.push(it.id);
        pts = pts.concat((keep ? it.pts : it.pts.slice().reverse()).slice(1));
        nodes = nodes.concat((keep ? it.nodes : it.nodes.slice().reverse()).slice(1));
      }
      for (let j; nodes[nodes.length - 1] !== nodes[0] && (j = step(nodes[0], false)) >= 0;) {
        used[j] = 1;
        const it = list[j];
        const keep = last(it) === nodes[0];
        ids.push(it.id);
        pts = (keep ? it.pts : it.pts.slice().reverse()).slice(0, -1).concat(pts);
        nodes = (keep ? it.nodes : it.nodes.slice().reverse()).slice(0, -1).concat(nodes);
      }
      out.push({ key, pts, nodes, ids });
    }
  }
  return out;
}

// Tram line routes (GEO.tramRoutes): the PTv2 route=tram relations of the day lines (ref 1-99; not the heritage lines 0
// and H, the night lines 2xx, or the two unversioned diversion variants of line 17), one per direction, sorted by line
// number and destination. A tram chain lists every route with one of its ways as a member (`routes`, indices into
// tramRoutes): the chains are cut at every switch, so a route uses a chain whole, and the runtime follows the route by
// taking, at each switch, a branch the route uses. A chain is not cut where a dropped track (a tunnel) leaves it, so a
// route can cover only part of one; it counts when its ways make up ROUTE_SHARE of the chain's length.
const ROUTE_SHARE = 0.5;
const allTramRoutes = osmTramRoutes.elements
  .filter((r) => r.type === 'relation' && tagOf(r).route === 'tram' && tagOf(r)['public_transport:version'] === '2' &&
    /^[1-9][0-9]?$/.test(tagOf(r).ref || ''))
  .map((r) => ({ ref: r.tags.ref, from: r.tags.from || '', to: r.tags.to || '', id: r.id,
    ways: new Set(r.members.filter((m) => m.type === 'way').map((m) => m.ref)) }))
  .sort((a, b) => +a.ref - +b.ref || a.to.localeCompare(b.to, 'pl') || a.id - b.id);

for (const t of trackWays) t.street = t.kind === 'tram' && onStreet(t.pts) ? 1 : 0;
// A switch whose branches differ in key (one street-running, one not; one-way and two-way) must stay a chain end too, or
// the branch would meet the other chain mid-way and the runtime would find no junction there
const pieceEnds = new Map();
for (const p of trackPieces) for (const n of [p.nodes[0], p.nodes[p.nodes.length - 1]]) pieceEnds.set(n, (pieceEnds.get(n) || 0) + 1);
const switchNodes = new Set([...pieceEnds].filter(([, k]) => k > 2).map(([n]) => n));
const rail = [];
for (const c of chainByNodes(trackPieces.map(({ way: t, pts, nodes }, id) => (
  { key: `${t.kind}|${t.street}|${t.tracks}|${t.oneway}`, pts, nodes, directed: !!t.oneway, id })), switchNodes)) {
  const [kind, street, tracks, oneway] = c.key.split('|');
  if (!touchesBox(c.pts, 0)) continue;
  const line = { kind, street: +street, tracks: +tracks, oneway: +oneway, pts: rdp(c.pts, 0.3).map(([x, z]) => [r1(x), r1(z)]) };
  if (kind === 'tram') {
    const total = c.ids.reduce((t, id) => t + lineLen(trackPieces[id].pts), 0);
    line.routes = allTramRoutes.flatMap((r, i) => {
      const on = c.ids.reduce((t, id) => t + (r.ways.has(trackPieces[id].way.id) ? lineLen(trackPieces[id].pts) : 0), 0);
      return on >= ROUTE_SHARE * total ? [i] : [];
    });
  }
  rail.push(line);
}
// Routes with no track in the box (line 1 runs Junikowo - Franowo south of it) are dropped and the indices renumbered
const routeIndex = allTramRoutes.map(() => -1);
for (const r of rail) for (const i of r.routes || []) routeIndex[i] = 0;
const tramRoutes = allTramRoutes.filter((_, i) => routeIndex[i] === 0);
allTramRoutes.forEach((r, i) => { if (routeIndex[i] === 0) routeIndex[i] = tramRoutes.indexOf(r); });
for (const r of rail) if (r.routes) r.routes = r.routes.map((i) => routeIndex[i]);

// Non-buildable rail land: landuse=railway areas, plus a corridor around every off-street track (street trams are
// covered by their road's widened stamp). 5 m per mapped rail track (1435 mm gauge, 4.5 m track centres), 4 m per tram.
const railCorridors = { rings: [], lines: [] };
for (const e of osmRail.elements) {
  if (tagOf(e).landuse !== 'railway') continue;
  for (let r of elemRings(e, toWorld)) {
    if (r.length < 4) continue;
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r = r.slice(0, -1);
    if (!touchesBox(r, PIECE_PAD) || Math.abs(ringArea(r)) < 50) continue;
    const s = rdpRing(r, 0.5).map(([x, z]) => [r1(x), r1(z)]);
    if (ringArea(s) > 0) s.reverse();
    railCorridors.rings.push(s);
  }
}
for (const t of trackWays) {
  if (t.street) continue;
  railCorridors.lines.push({ pts: rdp(t.pts, 0.3).map(([x, z]) => [r1(x), r1(z)]), w: t.kind === 'tram' ? 4 : 5 });
}

// Level crossings: a road and a mainline track meet at grade only on a shared node. Everywhere else one passes over
// the other (a rail bridge over the street, a road viaduct over the yard, an underpass kept at grade above).
const levelCrossings = [];
{
  const railNode = new Map();
  for (const t of trackWays) if (t.kind === 'rail') t.nodes.forEach((n, i) => railNode.set(n, t.pts[i]));
  const seen = new Set();
  for (const p of pieces) {
    for (const n of p.nodes) {
      const q = railNode.get(n);
      if (!q || seen.has(n) || !inDetailBox(q[0], q[1])) continue;
      seen.add(n);
      levelCrossings.push([r1(q[0]), r1(q[1])]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Plazas and pedestrian streets
// ---------------------------------------------------------------------------------------------------------------------
const plazas = [];
const pedestrianWays = [];
for (const e of osmRoads.elements) {
  const t = tagOf(e);
  const isArea = t['area:highway'] === 'pedestrian' || t.place === 'square' ||
    (t.highway === 'pedestrian' && (t.area === 'yes' || e.type === 'relation'));
  if (isArea) {
    // Inner rings of a pedestrian multipolygon are what stands on the square: Stary Rynek's (relation 153057) are the
    // central block's buildings. Planters, kiosks and fountain basins under PLAZA_HOLE_M2 are dropped.
    const inner = [];
    if (e.type === 'relation') {
      const swapped = { type: 'relation', members: (e.members || []).filter((m) => m.role === 'inner').map((m) => ({ ...m, role: 'outer' })) };
      for (let r of elemRings(swapped, toWorld)) {
        if (r.length < 4 || Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 0.5) continue;
        r = r.slice(0, -1);
        if (Math.abs(ringArea(r)) < PLAZA_HOLE_M2) continue;
        const s = rdpRing(r, 0.3).map(([x, z]) => [r1(x), r1(z)]);
        if (s.length < 3) continue;
        if (ringArea(s) < 0) s.reverse();
        inner.push(s);
      }
    }
    for (let r of elemRings(e, toWorld)) {
      if (r.length < 4 || Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 0.5) continue; // open
      r = r.slice(0, -1);
      if (!touchesBox(r, PIECE_PAD) || Math.abs(ringArea(r)) < 20) continue;
      const s = rdpRing(r, 0.3).map(([x, z]) => [r1(x), r1(z)]);
      if (s.length < 3) continue;
      if (ringArea(s) > 0) s.reverse();
      const holes = inner.filter((h) => pointInRing(h[0][0], h[0][1], s));
      plazas.push(holes.length ? { name: t.name || '', ring: s, holes } : { name: t.name || '', ring: s });
    }
  } else if (e.type === 'way' && t.highway === 'pedestrian' && e.geometry && !underground(t)) {
    const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
    if (!touchesBox(pts, PIECE_PAD)) continue;
    const w = parseFloat(t.width);
    // 8 m: a typical Poznań walking street (Półwiejska ≈ 12 m wall to wall, Stary Rynek lanes ≈ 6-10 m)
    pedestrianWays.push({ name: t.name || '', w: Number.isFinite(w) && w >= 2 && w <= 60 ? w : 8, pts: rdp(pts, 0.3).map(([x, z]) => [r1(x), r1(z)]) });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// GEO.roads: pieces merged into polylines per name / width / direction / lanes / class
// ---------------------------------------------------------------------------------------------------------------------
const roadItems = [];
for (const p of pieces) {
  const [mx, mz] = midOf(p.pts);
  if (!inDetailBox(mx, mz, ROADS_PAD)) continue;
  // One-way pieces drawn against their direction become forward ones: [-1, a→b] is [1, b→a]
  const rev = p.dir < 0;
  roadItems.push({ key: `${p.name}|${p.w}|${p.dir ? 1 : 0}|${p.lanes}|${p.cls}`, directed: p.dir !== 0,
    pts: rev ? p.pts.slice().reverse() : p.pts, nodes: rev ? p.nodes.slice().reverse() : p.nodes });
}
const roads = chainByNodes(roadItems).map((c) => {
  const [name, w, dir, lanes, cls] = c.key.split('|');
  const hw = ['motorway', 'trunk'].includes(baseCls(cls)) ? 1 : 0;
  return [name, +w, +dir, +lanes, hw, rdp(c.pts, 0.8).flatMap(([x, z]) => [r1(x), r1(z)])];
});

// ---------------------------------------------------------------------------------------------------------------------
// Point features
// ---------------------------------------------------------------------------------------------------------------------
const tramStops = [];
const signalNodes = [];
for (const e of osmPoints.elements) {
  if (e.type !== 'node') continue;
  const t = tagOf(e);
  const [x, z] = toWorld(e.lon, e.lat);
  if (!inDetailBox(x, z, PIECE_PAD)) continue;
  if (t.railway === 'tram_stop') tramStops.push({ name: t.name || '', x: r1(x), z: r1(z) });
  if (t.highway === 'traffic_signals') {
    signalNodes.push({ id: e.id, x, z, crossing: t.traffic_signals === 'crossing' || (t.crossing === 'traffic_signals' && t.traffic_signals !== 'signal') ? 1 : 0 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------------------------------------------------
const byCls = {};
for (const p of pieces) byCls[p.cls] = (byCls[p.cls] || 0) + 1;
const named = (f) => [...new Set(pieces.filter(f).map((p) => p.name).filter(Boolean))].sort();
log(`road pieces: ${pieces.length} from ${drivableWays.length} drivable ways (${droppedUnder} tunnel/underground ways dropped, ${underpassWays.size} railway underpasses kept); ${Object.entries(byCls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
log(`bridges: ${pieces.filter((p) => p.bridge).length} pieces (${named((p) => p.bridge).join(', ')})`);
log(`tram on street: ${pieces.filter((p) => p.tram).length} pieces, ${(pieces.filter((p) => p.tram).reduce((s, p) => s + lineLen(p.pts), 0) / 1000).toFixed(1)} km on ${named((p) => p.tram).length} streets`);
log(`plazas: ${plazas.length} (${[...new Set(plazas.map((p) => p.name).filter(Boolean))].length} named), pedestrian ways: ${pedestrianWays.length}`);
log(`rail: ${rail.length} lines (tram ${rail.filter((r) => r.kind === 'tram').length}, on street ${rail.filter((r) => r.street).length}; rail ${rail.filter((r) => r.kind === 'rail').length}); ${trackWays.length} track ways (${closedTram} closed tram ways kept from route=tram relations), ${droppedRailTunnel} tunnel ways dropped (${trackUnderpasses.size} railway underpasses kept); corridors ${railCorridors.rings.length} rings, ${railCorridors.lines.length} lines; ${levelCrossings.length} level crossings`);
{
  const tram = rail.filter((r) => r.kind === 'tram');
  const len = (rs) => rs.reduce((t, r) => t + lineLen(r.pts), 0) / 1000;
  log(`tram routes: ${tramRoutes.length} (lines ${[...new Set(tramRoutes.map((r) => r.ref))].join(', ')}; ${allTramRoutes.length - tramRoutes.length} with no track in the box dropped); ${len(tram.filter((r) => r.routes.length)).toFixed(1)} of ${len(tram).toFixed(1)} km of tram track on a route; every route on ${tramRoutes.map((_, i) => tram.filter((r) => r.routes.includes(i)).length).join('/')} chains`);
}
log(`roads: ${roads.length} polylines (${roads.reduce((t, r) => t + r[5].length / 2, 0)} pts); tram stops ${tramStops.length}; signal nodes ${signalNodes.length}`);

export { TRAM_W, pieces, plazas, pedestrianWays, rail, railCorridors, levelCrossings, roads, tramRoutes, tramStops, signalNodes, midOf,
  lineLen };
