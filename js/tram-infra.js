import * as THREE from 'three/webgpu';
import { Fn, attribute, color, float, vec2, mix, smoothstep, step, abs, fract, floor, fwidth, max, clamp, normalGeometry, positionGeometry, screenCoordinate, texture, uv } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './geodata.js';
import { BRIDGES, RAIL_BRIDGES, PLAZAS, JUNCTIONS, blockAt, isLand, isWater, roadClearance } from './city-config.js';
import { cityUniforms, createCurbMaterial, transparentEffectMRT } from './tsl-materials.js';

// js/tram-infra.js
// The static tram infrastructure (docs/poznan-plan.md Phase 9 step 1), built once after the road network so it can keep
// clear of the car lanes without feeding obstacles back into them:
// - grooved rails for every tram track of GEO.rail (two 70 mm heads at 1435 mm gauge, flush with the road on
//   street-running track; ballast and concrete sleepers narrowed or omitted to clear road and junction footprints)
// - the overhead line: a contact wire 5.8 m over each track, carried every ~30 m by span wires between side poles (or a
//   centre pole between the tracks), cantilever arms on one-sided poles, or wall rosettes in the narrow streets round
//   the Old Town
// - tram stops from GEO.tramStops: a raised platform island on the right of the track where it fits clear of the car
//   lanes (else the stop stands on the sidewalk, as on the Poznań streets with no room for an island), a glass shelter,
//   a stop sign with the stop's name plate and a ticket machine
// - the mainline railway (GEO.rail kind 'rail'): ballast beds with concrete sleepers and raised rails, cut with a
//   concrete end wall wherever a road or tram line crosses (the bridges and underpasses have no levels here) and laid
//   flush across the road at the level crossings (GEO.levelCrossings), and the 3 kV DC overhead line (contact and messenger wire, masts with cantilevers, portals over the yards)
// layoutTramInfrastructure(network) and layoutRailInfrastructure(network) are the pure placements (no three.js) that
// tests/tram-infra.test.cjs checks; the tram layout's `stops` list is the public one trams can dwell at.

const GAUGE = 1.435;
const HEAD_W = 0.07; // grooved rail head (Ri60-ish)
const GROOVE_W = 0.042;
const SW_TOP = 0.22; // city-grid.js sidewalk top
const PIECE = 4; // rails and ballast are laid as straight pieces up to this long, so they follow curbs and bends
const BED_HALF = 1.45; // off-street ballast, 2.9 m across
const BED_MIN = 1.2; // narrower beds are flush rather than leaving too little room for sleepers
const BED_GAP = 0.05; // ...and this far outside it
const LANE_HALF = 1.8; // half of road-network.js LANE_W: a lane's paint lines stand this far from its centreline
const WIRE_Y = 5.8; // contact wire height
const SPAN_Y = 6.6; // span wires and cantilever arms
const STATION = 30; // support spacing along the track
// Platforms keep this far from a car lane's centreline: road-network.js closes a lane when an obstacle box comes within
// LANE_CLEAR 1.2 m of it along both axes, which reaches ~1.7 m on a diagonal street
const LANE_KEEP = 1.75;
const TRACK_KEEP = 1.75; // poles & shelters keep this far from a track centreline (2.4 m car body + sway)
const PLATFORM_EDGE = 1.35; // track centreline to platform edge
const PLATFORM_W = 2.6;
const PLATFORM_L = 33; // a 32 m Moderus Gamma or Tramino
const PLATFORM_H = 0.25;
const OLD_TOWN_R = 900; // wall rosettes instead of poles on narrow streets this close to the Ratusz
// Mainline railway. The world is flat: every track lies at grade, dropped over open water (rail bridges have no deck)
// and wherever it meets a road or a tram line (see RAIL_ROAD_KEEP).
const RAIL_PIECE = 8; // straight pieces up to 8 m: a 300 m curve is 27 mm off the chord
const RAIL_BED_W = 5; // ballast bed at the foot; its top is 4 m (RAIL_BED_TOP_W), so 4.5 m track centres close up
const RAIL_BED_TOP_W = 4;
const RAIL_SLEEPER = 2.6; // PS-94 concrete sleeper length
const RAIL_BED_TOP = 0.3;
const RAIL_HEAD_H = 0.16; // 60E1 rail on its sleeper
// The railway crosses streets and tram lines on bridges and in underpasses, which the flat world has no levels for: a
// piece is cut when its centreline comes within RAIL_ROAD_KEEP of a roadway (the 2.5 m half bed + 1 m) or within
// RAIL_TRAM_KEEP of a tram track centreline (half bed + 1 m + the tram's 1.45 m half ballast)
const RAIL_ROAD_KEEP = 3.5;
const RAIL_TRAM_KEEP = 5;
// Level crossings (GEO.levelCrossings): a run of road-cut pieces passing within RAIL_LEVEL_NEAR of one keeps its rails,
// flush with the road (RAIL_LEVEL_TOP) and with no end walls, so the fences simply end at the crossing
const RAIL_LEVEL_NEAR = 3;
const RAIL_LEVEL_TOP = 0.016;
const RAIL_END_H = 1.1; // concrete end wall where a bed is cut
// Corridor boundary along the outer edge of a track bundle: a concrete plinth with a 2 m welded-mesh fence, 1.1 m
// outside the bed's foot; a 1.2 m wall under the fence where a street, a block or open land (a car park, a plaza) lies
// beyond, the plinth alone between parallel bundles and along the water
const RAIL_FENCE_O = 3.6; // track centreline to the boundary
const RAIL_FENCE_H = 2;
const RAIL_PLINTH_H = 0.5;
const RAIL_WALL_H = 1.2;
const RAIL_FENCE_ROAD = 1; // the boundary keeps this far outside every roadway
const RAIL_STUB = 8; // run ends this close to another run end or an end wall's corner are joined by a stub
// The player's keep-out: every ground point within RAIL_KEEPOUT of a kept piece (just inside the boundary, so the fence
// collider stops a body first), plus the ground between two tracks too close for a boundary between them, on a 1 m
// raster
const RAIL_KEEPOUT = 3.4;
const KEEPOUT_TILE = 64; // raster tiles (1 m cells), stored only where there is corridor
const RAIL_WIRE_Y = 5.6; // PKP contact wire height
const RAIL_MESSENGER_Y = 7.0; // messenger wire at the supports
const RAIL_STATION = 55; // support spacing
const RAIL_KEEP = 2.6; // masts keep this far from every rail track centreline (structure gauge)
const RAIL_MAST_ROAD = 2; // ...this far outside every roadway
const RAIL_MAST_TRAM = 3; // ...and this far from every tram track centreline
const RAIL_ARM_REACH = 7; // a mast this close to the track takes a cantilever, else a portal spans the yard
const RAIL_PORTAL_REACH = 40; // per side

// --- Track geometry ------------------------------------------------------------------------------------------------
// Tram tracks of GEO.rail (railIndex = index into GEO.rail), with cumulative arc length per point
function loadTracks(kind = 'tram') {
  const tracks = [];
  GEO.rail.forEach((r, railIndex) => {
    if (r.kind !== kind || r.pts.length < 4) return;
    const p = r.pts;
    const n = p.length / 2;
    const cum = new Float64Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    tracks.push({ railIndex, street: r.street, oneway: r.oneway, p, n, cum, len: cum[n - 1] });
  });
  return tracks;
}

// Point, unit tangent and segment at arc length s along a track (clamped)
function pointAt(tr, s) {
  const { p, cum, n } = tr;
  s = Math.max(0, Math.min(tr.len, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const L = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / L;
  const dx = (p[2 * hi] - p[2 * lo]) / L;
  const dz = (p[2 * hi + 1] - p[2 * lo + 1]) / L;
  return { x: p[2 * lo] + (p[2 * hi] - p[2 * lo]) * t, z: p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * t, dx, dz, k: lo };
}

// Uniform grid of line segments for nearest-segment queries
function segmentGrid(cell = 24) {
  const cells = new Map();
  const key = (ix, iz) => ix * 100003 + iz;
  let stamp = 0; // query counter: a segment spanning several cells is visited once per query (cheaper than a Set)
  return {
    add(ax, az, bx, bz, data) {
      const seg = { ax, az, bx, bz, data, _q: 0 };
      for (let ix = Math.floor(Math.min(ax, bx) / cell); ix <= Math.floor(Math.max(ax, bx) / cell); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / cell); iz <= Math.floor(Math.max(az, bz) / cell); iz++) {
          const k = key(ix, iz);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(seg);
        }
      }
    },
    // Nearest segment within r of (x, z) passing `accept`: { seg, d, t, qx, qz } or null
    nearest(x, z, r, accept) {
      let best = null;
      let bestD = r;
      const q = ++stamp;
      for (let ix = Math.floor((x - r) / cell); ix <= Math.floor((x + r) / cell); ix++) {
        for (let iz = Math.floor((z - r) / cell); iz <= Math.floor((z + r) / cell); iz++) {
          for (const sg of cells.get(key(ix, iz)) || []) {
            if (sg._q === q) continue;
            sg._q = q;
            if (accept && !accept(sg)) continue;
            const ex = sg.bx - sg.ax;
            const ez = sg.bz - sg.az;
            const t = Math.max(0, Math.min(1, ((x - sg.ax) * ex + (z - sg.az) * ez) / (ex * ex + ez * ez || 1)));
            const qx = sg.ax + ex * t;
            const qz = sg.az + ez * t;
            const d = Math.hypot(qx - x, qz - z);
            if (d < bestD) {
              bestD = d;
              best = { seg: sg, d, t, qx, qz };
            }
          }
        }
      }
      return best;
    },
    // Every segment crossing the segment a-b: [{ seg, x, z }]
    crossing(ax, az, bx, bz) {
      const out = [];
      const q = ++stamp;
      for (let ix = Math.floor(Math.min(ax, bx) / cell); ix <= Math.floor(Math.max(ax, bx) / cell); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / cell); iz <= Math.floor(Math.max(az, bz) / cell); iz++) {
          for (const sg of cells.get(key(ix, iz)) || []) {
            if (sg._q === q) continue;
            sg._q = q;
            const rx = bx - ax;
            const rz = bz - az;
            const sx = sg.bx - sg.ax;
            const sz = sg.bz - sg.az;
            const den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((sg.ax - ax) * sz - (sg.az - az) * sx) / den;
            const u = ((sg.ax - ax) * rz - (sg.az - az) * rx) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ seg: sg, x: ax + rx * t, z: az + rz * t });
          }
        }
      }
      return out;
    }
  };
}

// Distance to the nearest car lane centreline (capped at r): every lane of every street the network paints (the drivable
// set before its connectivity filter, so streets traffic doesn't use count as roadway too), and the curves traffic
// turns along through the junctions (8 chords each): poles kept 2 m off the straight lanes alone stood on 15 turns
function laneDistance(network) {
  const laneGrid = segmentGrid(32);
  for (const e of (network && (network.paintEdges || network.edges)) || []) {
    const span = e.span ?? e.len;
    for (const o of e.lanes) {
      const ax = e.x0 + e.rx * o;
      const az = e.z0 + e.rz * o;
      laneGrid.add(ax, az, ax + e.dx * span, az + e.dz * span, null);
    }
  }
  if (network && network.connector && network.curvePoint) {
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const e of network.edges) {
      for (const m of e.moves || []) {
        for (let i = 0; i < m.out.length; i++) {
          if (m.out[i] < 0) continue;
          const c = network.connector(e, i, m.to, m.out[i]);
          network.curvePoint(c, 0, p);
          for (let k = 1; k <= 8; k++) {
            const ax = p.x, az = p.z;
            network.curvePoint(c, c.len * k / 8, p);
            laneGrid.add(ax, az, p.x, p.z, null);
          }
        }
      }
    }
  }
  return (x, z, r = 6) => {
    const h = laneGrid.nearest(x, z, r);
    return h ? h.d : r;
  };
}

// Graph points follow the original carriageway axis. The extra tram strip is added on one side, so its
// centre is shifted by 3.25 m; subtracting that shift returns the carriageway to the original graph points.
const TRAM_STRIP_W = 6.5; // poz-roads.mjs TRAM_W
function carriagewayDistance() {
  const CELL = 32;
  const cells = new Map();
  const g = GEO.roadGraph;
  const segments = [];
  for (const [a, b, , w, , , inner, flags] of g.links) {
    const half = Math.max(0.5, (w > 3 ? w : 9.1) / 2 - (flags & 24 ? TRAM_STRIP_W / 2 : 0));
    const pts = [g.nodes[2 * a], g.nodes[2 * a + 1], ...inner, g.nodes[2 * b], g.nodes[2 * b + 1]];
    for (let k = 0; k + 3 < pts.length; k += 2) {
      segments.push([pts[k], pts[k + 1], pts[k + 2], pts[k + 3], half]);
    }
  }
  for (const seg of segments) {
    const m = seg[4] + 4;
    const minX = Math.floor((Math.min(seg[0], seg[2]) - m) / CELL);
    const maxX = Math.floor((Math.max(seg[0], seg[2]) + m) / CELL);
    const minZ = Math.floor((Math.min(seg[1], seg[3]) - m) / CELL);
    const maxZ = Math.floor((Math.max(seg[1], seg[3]) + m) / CELL);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const key = ix * 100003 + iz;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(seg);
      }
    }
  }
  return (x, z, r = 4) => {
    let best = r;
    for (const [ax, az, bx, bz, half] of cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || []) {
      const ex = bx - ax;
      const ez = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z) - half);
    }
    return best;
  };
}

// The bed is narrowed or laid flush to clear graph carriageways, lanes and junction turning paths. The inferred
// tram strip beside a carriageway is separate; street flags alone miss independently mapped on-road tracks.
// Raised islands and the three surveyed bridge-deck crossings are handled separately.
function layoutTrackBeds(tracks, laneDist) {
  const carriageway = carriagewayDistance();
  // The broad guide includes tram reservations along roads, so use it only inside actual junction centres.
  const junctions = new Map();
  for (const j of JUNCTIONS) {
    if (j.arms.length < 3) continue;
    const key = `${Math.floor(j.x / 32)},${Math.floor(j.z / 32)}`;
    if (!junctions.has(key)) junctions.set(key, []);
    junctions.get(key).push(j);
  }
  const junctionRoad = (x, z) => {
    const ix = Math.floor(x / 32), iz = Math.floor(z / 32);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of junctions.get(`${ix + dx},${iz + dz}`) || []) {
          if (Math.hypot(x - j.x, z - j.z) < 10) return roadClearance(x, z);
        }
      }
    }
    return Infinity;
  };
  const roadwayDist = (x, z) => Math.min(carriageway(x, z, 4), junctionRoad(x, z),
    laneDist(x, z, 4 + LANE_HALF) - LANE_HALF);
  const beds = [];
  for (const tr of tracks) {
    const count = Math.max(1, Math.ceil(tr.len / PIECE));
    for (let i = 0; i < count; i++) {
      const s0 = (i * tr.len) / count;
      const A = pointAt(tr, s0);
      const B = pointAt(tr, ((i + 1) * tr.len) / count);
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if ((!isLand(mx, mz) && (tr.street !== 1 || !isWater(mx, mz))) || len < 0.01) continue;
      const ground = tr.street === 1 ? 0 : (blockAt(mx, mz) ? SW_TOP : 0);
      let bed = 0;
      if (tr.street !== 1 && !ground) {
        // the roadway's distance from the centreline every 0.5 m along the piece: a box `half` either side of it stays
        // clear when that is half + 0.25 m (half the step) + BED_GAP
        let room = Infinity;
        const underBridgeDeck = (mx > -1570 && mx < -1520 && mz > 535 && mz < 620) ||
          (mx > -1445 && mx < -1395 && mz > 50 && mz < 135) ||
          (mx > -1380 && mx < -1345 && mz > -230 && mz < -170);
        if (!underBridgeDeck) {
          const n = Math.max(2, Math.ceil(len / 0.5));
          for (let k = 0; k <= n; k++) {
            room = Math.min(room, roadwayDist(A.x + (B.x - A.x) * k / n, A.z + (B.z - A.z) * k / n));
          }
          const half = Math.min(BED_HALF, room - 0.25 - BED_GAP);
          if (half >= BED_MIN) bed = half;
        }
      }
      beds.push({ railIndex: tr.railIndex, s0, ax: A.x, az: A.z, bx: B.x, bz: B.z, ground, bed });
    }
  }
  return { beds, roadwayDist };
}

/**
 * Placement of the tram infrastructure against a built road network (road-network.js buildRoadNetwork; only its
 * paintEdges / edges lanes are read). Returns
 * { tracks, stops, poles, spans, arms, rosettes, droppers }:
 * - stops: [{ name, x, z, heading, railIndex, s, dir, side, kind: 'island'|'curb', platform, shelter, sign, machine }]
 *   x, z, s: the stop point on the track (s = arc length along GEO.rail[railIndex].pts), dir: +1 when trams run along
 *   the points, heading: their travel heading (0 = +z), side: +1 when the platform is right of the points' direction.
 *   platform: { s0, s1, o0, o1 } (o = lateral offsets right of the points' direction; null on a curb stop).
 * - poles: [{ x, z, h }], spans: [{ ax, az, bx, bz }] (wires at SPAN_Y), arms: cantilevers, droppers: [{ x, z, y0 }]
 */
function layoutTramInfrastructure(network) {
  const tracks = loadTracks();
  const trackGrid = segmentGrid();
  for (const tr of tracks) {
    for (let k = 0; k + 1 < tr.n; k++) {
      trackGrid.add(tr.p[2 * k], tr.p[2 * k + 1], tr.p[2 * k + 2], tr.p[2 * k + 3], { tr, k });
    }
  }
  const laneDist = laneDistance(network);
  const trackDist = (x, z, r = 4, except = null) => {
    const h = trackGrid.nearest(x, z, r, except ? (sg) => sg.data.tr !== except : null);
    return h ? h.d : r;
  };
  // Poles keep 2 m from a lane centreline: the road network tests obstacles by box overlap, so a pole is clear of its
  // 1.2 m only beyond 1.2 + 0.16 m along both axes (up to 1.92 m diagonally)
  const clearSpot = (x, z, keep = TRACK_KEEP) => isLand(x, z) && laneDist(x, z) >= 2.0 && trackDist(x, z) >= keep;
  const onCurb = (x, z) => {
    const b = blockAt(x, z);
    return !!(b && !b.median);
  };

  // --- Overhead line supports ---------------------------------------------------------------------------------------
  const poles = [];
  const spans = [];
  const arms = [];
  const rosettes = [];
  const droppers = [];
  const supported = segmentGrid(32); // short marks across each track where a support already carries its wire
  const poleAt = (x, z, h) => {
    for (const q of poles) if (Math.abs(q.x - x) < 1.2 && Math.abs(q.z - z) < 1.2) return q;
    const q = { x, z, h };
    poles.push(q);
    return q;
  };
  // March out from the track (x, z) along (nx, nz) to the first curb a pole can stand on (0.6 m behind the curb edge),
  // else the first clear spot on the way (a reservation, or a street with no car lane on that side)
  const march = (x, z, nx, nz, maxO) => {
    let first = null;
    for (let o = TRACK_KEEP; o <= maxO; o += 0.25) {
      const px = x + nx * o;
      const pz = z + nz * o;
      if (!isLand(px, pz)) break;
      if (!clearSpot(px, pz)) continue;
      if (onCurb(px, pz)) {
        const ix = px + nx * 0.6;
        const iz = pz + nz * 0.6;
        if (onCurb(ix, iz) && clearSpot(ix, iz)) return { x: ix, z: iz, o: o + 0.6, curb: true };
      }
      if (!first) first = { x: px, z: pz, o, curb: false };
    }
    return first;
  };
  // Mark the wire as carried where a support line a-b crosses the tracks
  const markCrossings = (ax, az, bx, bz) => {
    for (const c of trackGrid.crossing(ax, az, bx, bz)) {
      droppers.push({ x: c.x, z: c.z, y0: SPAN_Y });
      supported.add(c.x - 0.1, c.z, c.x + 0.1, c.z, c.seg.data.tr);
    }
  };
  for (const tr of tracks) {
    if (tr.len < 14) continue;
    const count = Math.max(1, Math.round(tr.len / STATION));
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * tr.len / count;
      const P = pointAt(tr, s);
      if (supported.nearest(P.x, P.z, STATION * 0.4, (sg) => sg.data === tr)) continue;
      const nx = -P.dz;
      const nz = P.dx;
      const street = tr.street === 1;
      const R = march(P.x, P.z, nx, nz, street ? 16 : 5);
      const L = march(P.x, P.z, -nx, -nz, street ? 16 : 5);
      // Narrow Old Town streets: span wires anchored on the house fronts (lots stand ~4.6 m behind the curb)
      if (street && R && L && R.curb && L.curb && R.o + L.o < 15 && Math.hypot(P.x, P.z) < OLD_TOWN_R) {
        const ra = { x: R.x + nx * 3.8, z: R.z + nz * 3.8 };
        const la = { x: L.x - nx * 3.8, z: L.z - nz * 3.8 };
        if (onCurb(ra.x, ra.z) && onCurb(la.x, la.z)) {
          rosettes.push({ x: ra.x, z: ra.z, nx: -nx, nz: -nz }, { x: la.x, z: la.z, nx, nz });
          spans.push({ ax: la.x, az: la.z, bx: ra.x, bz: ra.z });
          markCrossings(la.x, la.z, ra.x, ra.z);
          continue;
        }
      }
      if (street && R && L && R.o + L.o <= 32) {
        const a = poleAt(L.x, L.z, 7.6);
        const b = poleAt(R.x, R.z, 7.6);
        spans.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        markCrossings(a.x, a.z, b.x, b.z);
        continue;
      }
      // One-sided: a pole with a cantilever arm reaching 0.4 m past the track
      const side = R && (!L || R.o <= L.o) ? R : L;
      if (!side || side.o > 9) continue;
      const q = poleAt(side.x, side.z, street ? 7.6 : 7.0);
      const ux = (P.x - q.x) / side.o;
      const uz = (P.z - q.z) / side.o;
      const ex = P.x + ux * 0.4;
      const ez = P.z + uz * 0.4;
      arms.push({ ax: q.x, az: q.z, bx: ex, bz: ez });
      markCrossings(q.x, q.z, ex, ez);
    }
  }

  // --- Tram stops ---------------------------------------------------------------------------------------------------
  const stops = [];
  const skipped = []; // [{ name, x, z, why }] stop nodes left without a stop
  const platformClear = (tr, s0, s1, o0, o1) => {
    for (let s = s0; s <= s1 + 1e-6; s += 1) {
      const P = pointAt(tr, s);
      for (const o of [o0, (o0 * 3 + o1) / 4, (o0 + o1) / 2, (o0 + o1 * 3) / 4, o1]) {
        const x = P.x - P.dz * o;
        const z = P.z + P.dx * o;
        if (!isLand(x, z) || laneDist(x, z) < LANE_KEEP) return false;
        // ...and clear of the other tracks (not tested at the track-side edge, which the chain continuing the
        // platform's own track past a switch passes as close as its own track)
        if (o !== o0 && trackDist(x, z, 4, tr) < PLATFORM_EDGE) return false;
      }
    }
    return true;
  };
  for (const st of GEO.tramStops) {
    const hit = trackGrid.nearest(st.x, st.z, 25);
    if (!hit) {
      skipped.push({ ...st, why: 'no track' });
      continue;
    }
    const { tr, k } = hit.seg.data;
    const s = tr.cum[k] + hit.t * (tr.cum[k + 1] - tr.cum[k]);
    // Several nodes for one stop position on one track
    if (stops.some((o) => o.railIndex === tr.railIndex && Math.abs(o.s - s) < 20)) continue;
    const P = pointAt(tr, s);
    const nx = -P.dz;
    const nz = P.dx;
    // The paired track of a two-track line: the nearest other, roughly parallel track 2–8 m to one side
    let pairSide = 0;
    for (const o of [3, 4.5, 6, 2.5, 7.5]) {
      for (const sg of [1, -1]) {
        const h = trackGrid.nearest(P.x + nx * o * sg, P.z + nz * o * sg, 1.2, (seg) => seg.data.tr !== tr);
        if (!h) continue;
        const ex = h.seg.bx - h.seg.ax;
        const ez = h.seg.bz - h.seg.az;
        if (Math.abs(ex * P.dx + ez * P.dz) / (Math.hypot(ex, ez) || 1) > 0.9) {
          pairSide = sg;
          break;
        }
      }
      if (pairSide) break;
    }
    // One-way track: the platform is on the right; two-way: away from the paired track (both sides tried if alone)
    const sides = tr.oneway ? [1] : pairSide ? [-pairSide] : [1, -1];
    let stop = null;
    for (const side of sides) {
      const dir = tr.oneway ? 1 : side; // travel direction with the platform on the right
      const half = Math.min(PLATFORM_L / 2, tr.len / 2);
      const sc = Math.max(half, Math.min(tr.len - half, s));
      for (const w of [PLATFORM_W, 2.0, 1.5]) {
        const o0 = side * PLATFORM_EDGE;
        const o1 = side * (PLATFORM_EDGE + w);
        if (half >= 9 && platformClear(tr, sc - half, sc + half, Math.min(o0, o1), Math.max(o0, o1))) {
          stop = { side, dir, kind: 'island', platform: { s0: sc - half, s1: sc + half, o0, o1 }, sc };
          break;
        }
      }
      if (stop) break;
      // No room for an island: the stop stands on the sidewalk if one runs within 12 m of the track (passengers cross
      // the traffic lane to board, as at the Poznań stops with no island)
      for (let o = PLATFORM_EDGE; o <= 12; o += 0.25) {
        const x = P.x + nx * o * side;
        const z = P.z + nz * o * side;
        if (!onCurb(x, z)) continue;
        let depth = 0;
        while (depth < 4.5 && onCurb(x + nx * (depth + 0.25) * side, z + nz * (depth + 0.25) * side)) depth += 0.25;
        const along = [-3, 3].every((d) => onCurb(x + nx * 0.6 * side + P.dx * d, z + nz * 0.6 * side + P.dz * d));
        if (depth >= 1.0 && along) stop = { side, dir, kind: 'curb', platform: null, curbO: o, depth, sc: s };
        break;
      }
      if (stop) break;
    }
    if (!stop) {
      skipped.push({ ...st, why: 'no room' });
      continue;
    }
    // Furniture in the stop's frame: f along the travel direction, r away from the track
    const C = pointAt(tr, stop.sc);
    const fx = C.dx * stop.dir;
    const fz = C.dz * stop.dir;
    const rx = -C.dz * stop.side;
    const rz = C.dx * stop.side;
    const base = stop.kind === 'island' ? PLATFORM_EDGE : stop.curbO;
    // usable depth: the island, or the sidewalk up to 3.4 m behind the curb (shops and gardens beyond)
    const width = stop.kind === 'island' ? Math.abs(stop.platform.o1 - stop.platform.o0) : Math.min(stop.depth, 3.4);
    const y = stop.kind === 'island' ? PLATFORM_H : SW_TOP;
    const at = (f, r) => ({ x: C.x + fx * f + rx * r, z: C.z + fz * f + rz * r });
    const yaw = Math.atan2(rx, rz); // local +z (the shelter's open front) faces the track: rotate by yaw then flip
    // A shelter (1.6 m roof) needs 2 m; its back stands 0.2 m in from the island's or sidewalk's far edge
    stop.shelter = width >= 2.0 ? { ...at(-2, base + width - 0.85), y, yaw: yaw + Math.PI, len: width >= 2.4 ? 4.4 : 3.2 } : null;
    stop.sign = { ...at(stop.kind === 'island' ? 12 : 9, base + 0.55), y, yaw: Math.atan2(fx, fz) };
    stop.machine = { ...at(2.2, base + width - 0.45), y, yaw: yaw + Math.PI };
    // Curb stops keep their furniture on the sidewalk and off the tracks
    if (stop.kind === 'curb' && ![stop.shelter, stop.sign, stop.machine].every((p) => !p || onCurb(p.x, p.z))) {
      if (!onCurb(stop.sign.x, stop.sign.z)) {
        skipped.push({ ...st, why: 'no sign spot' });
        continue;
      }
      if (stop.shelter && !onCurb(stop.shelter.x, stop.shelter.z)) stop.shelter = null;
      if (!onCurb(stop.machine.x, stop.machine.z)) stop.machine = null;
    }
    stops.push({
      name: st.name,
      x: P.x,
      z: P.z,
      heading: Math.atan2(P.dx * stop.dir, P.dz * stop.dir),
      railIndex: tr.railIndex,
      s,
      dir: stop.dir,
      side: stop.side,
      kind: stop.kind,
      platform: stop.platform,
      shelter: stop.shelter,
      sign: stop.sign,
      machine: stop.machine
    });
  }

  const { beds, roadwayDist } = layoutTrackBeds(tracks, laneDist);

  // Ground footprints of everything placed, as small axis-aligned boxes (platforms sampled every 1.5 m): none goes to
  // the road network (built before this), but tests/tram-infra.test.cjs feeds them to it to prove no lane is crowded
  const footprints = [];
  const box = (x, z, h) => footprints.push({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
  for (const q of poles) box(q.x, q.z, 0.16);
  for (const st of stops) {
    for (const f of [st.shelter, st.sign, st.machine]) if (f) box(f.x, f.z, 0.4);
    if (!st.platform) continue;
    const tr = tracks.find((t) => t.railIndex === st.railIndex);
    const { s0, s1, o0, o1 } = st.platform;
    for (let s = s0; s <= s1 + 1e-6; s += 1.5) {
      const P = pointAt(tr, s);
      for (let k = 0; k <= 4; k++) {
        const o = o0 + (o1 - o0) * (0.08 + (0.84 * k) / 4);
        box(P.x - P.dz * o, P.z + P.dx * o, 0.2);
      }
    }
  }

  return { tracks, stops, skipped, poles, spans, arms, rosettes, droppers, footprints, laneDist, trackDist, beds, roadwayDist };
}

/**
 * Placement of the mainline railway (GEO.rail kind 'rail') against a built road network. The world is flat and the
 * railway crosses the streets and tram lines on bridges and in underpasses, so a track is cut wherever its bed would
 * touch a roadway or a tram track; each cut end gets an end wall, as at the edge of a bridge. Returns
 * { tracks, pieces, dropped, ends, masts, arms, portals, droppers, footprints, laneDist, roadDist, tramDist }:
 * - pieces: [{ railIndex, s0, ax, az, bx, bz, ground }] straight pieces up to RAIL_PIECE long (s0 = arc length of a)
 * - dropped: { offLand, water, road, tram } pieces left out: outside the detail box, over open water (rail bridges have
 *   no deck), on or within RAIL_ROAD_KEEP of a roadway (or under a road bridge), within RAIL_TRAM_KEEP of a tram track
 * - level: [{ railIndex, ax, az, bx, bz, ground }] the road-cut pieces of a level crossing, laid as flush rails (counted
 *   in dropped.road)
 * - ends: [{ x, z, dx, dz, ground, s, inward, tr }] end walls where a kept piece meets a dropped one (d: pointing into
 *   the gap; s: arc length of the end, inward: +1 when the kept bed lies at larger s)
 * - runs: corridor boundary runs [{ railIndex, side, pts: [{ x, z }], solid: [0|1 per segment], s0 }] RAIL_FENCE_O out
 *   on the side (+1 right of the points' direction) facing away from the bundle; solid: the wall under the fence
 *   (stub: true on the short runs that close a gap between two run ends or a run end and an end wall)
 * - corridor: { has(x, z), cells, bands } the player keep-out raster (see RAIL_KEEPOUT)
 * - masts: [{ x, z, h }], arms: cantilevers [{ ax, az, bx, bz }] (mast to 0.3 m past the track), portals: cross beams
 *   [{ ax, az, bx, bz }] between two masts, droppers: [{ x, z }] where a portal beam carries a track's wires
 */
function layoutRailInfrastructure(network) {
  const tracks = loadTracks('rail');
  const laneDist = laneDistance(network);
  // Road bridge decks: the BRIDGES links' corridors (half width + 1.5 m); a track under one runs beneath the flat deck
  const deckGrid = segmentGrid(32);
  for (const br of BRIDGES) {
    if (br.name === 'Most Teatralny' || br.name === 'Most Uniwersytecki' || br.name === 'Most Dworcowy' || br.name === 'Franklina Roosevelta' || br.name === 'Dworcowa') continue;
    for (const l of br.links) {
      for (let k = 0; k + 1 < l.pts.length; k++) {
        deckGrid.add(l.pts[k].x, l.pts[k].z, l.pts[k + 1].x, l.pts[k + 1].z, Math.max(l.width / 2 + 4.5, 12));
      }
    }
  }
  const underDeck = (x, z) => {
    const h = deckGrid.nearest(x, z, 25);
    return !!h && h.d <= h.seg.data;
  };
  // Distance outside the nearest roadway: the LANE_GUIDE carriageways (junction to junction, so junction boxes too),
  // and the network's lane centrelines less a 1.75 m half lane; RAIL_ROAD_KEEP + 1 where nothing is that near
  const roadDist = (x, z) => {
    if (underDeck(x, z)) return Infinity;
    const g = roadClearance(x, z);
    return Math.min(Number.isFinite(g) ? g : RAIL_ROAD_KEEP + 1, laneDist(x, z, RAIL_ROAD_KEEP + 3) - 1.75);
  };
  const railGrid = segmentGrid();
  for (const tr of tracks) {
    for (let k = 0; k + 1 < tr.n; k++) railGrid.add(tr.p[2 * k], tr.p[2 * k + 1], tr.p[2 * k + 2], tr.p[2 * k + 3], tr);
  }
  const tramGrid = segmentGrid();
  for (const tr of loadTracks('tram')) {
    for (let k = 0; k + 1 < tr.n; k++) tramGrid.add(tr.p[2 * k], tr.p[2 * k + 1], tr.p[2 * k + 2], tr.p[2 * k + 3], tr);
  }
  const railDist = (x, z, r = 4) => {
    const h = railGrid.nearest(x, z, r);
    return h ? h.d : r;
  };
  const tramDist = (x, z, r = RAIL_TRAM_KEEP + 1) => {
    if (underDeck(x, z)) return r;
    const h = tramGrid.nearest(x, z, r);
    return h ? h.d : r;
  };
  const levelGrid = segmentGrid(32);
  const lx = GEO.levelCrossings || [];
  for (let k = 0; k + 1 < lx.length; k += 2) levelGrid.add(lx[k], lx[k + 1], lx[k], lx[k + 1] + 0.001, k / 2);
  const segNear = (A, B, r) => {
    for (let t = 0; t <= 1; t += 0.125) if (levelGrid.nearest(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t, r)) return true;
    return false;
  };

  // --- Track pieces -------------------------------------------------------------------------------------------------
  const pieces = [];
  const ends = [];
  const dropped = { offLand: 0, water: 0, road: 0, tram: 0 };
  const level = []; // [{ railIndex, ax, az, bx, bz, ground }] flush pieces over level crossings
  const viaducts = []; // [{ railIndex, ax, az, bx, bz, pieces, spanLen, mx, mz, hasTram, yClearance, deckY }]
  const keptAt = new Map(); // railIndex -> Uint8Array: 1 for every kept piece
  const trackGeo = new Map(); // railIndex -> { geo: [{ s0, A, B }] per piece, kept }
  for (const tr of tracks) {
    const count = Math.max(1, Math.ceil(tr.len / RAIL_PIECE));
    const kept = new Uint8Array(count);
    const why = new Array(count).fill(null);
    const geo = [];
    for (let i = 0; i < count; i++) {
      const s0 = (i * tr.len) / count;
      const A = pointAt(tr, s0);
      const B = pointAt(tr, ((i + 1) * tr.len) / count);
      geo.push({ s0, A, B });
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      if (!isLand(mx, mz)) {
        why[i] = isWater(mx, mz) ? 'water' : 'offLand';
        continue;
      }
      // the bed's centreline at both ends, the quarters and the middle
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = A.x + (B.x - A.x) * t;
        const z = A.z + (B.z - A.z) * t;
        if (roadDist(x, z) < RAIL_ROAD_KEEP) why[i] = 'road';
        else if (!underDeck(x, z) && tramDist(x, z) < RAIL_TRAM_KEEP) why[i] = why[i] || 'tram';
        if (why[i] === 'road') break;
      }
      if (why[i]) continue;
      kept[i] = 1;
      pieces.push({ railIndex: tr.railIndex, s0, ax: A.x, az: A.z, bx: B.x, bz: B.z, ground: blockAt(mx, mz) ? SW_TOP : 0 });
    }
    for (let i = 0; i < count; i++) if (why[i]) dropped[why[i]]++;
    // Railway crossings over roadways: all cuts across road corridors (including Libelta and former level crossings)
    // are bridged overhead by elevated viaduct spans (rail.viaducts), leaving roadways 100% unobstructed below
    for (let i = 0; i < count;) {
      if (why[i] !== 'road' && why[i] !== 'tram') { i++; continue; }
      let j = i;
      while (j < count && (why[j] === 'road' || why[j] === 'tram')) j++;
      // Railway viaduct over a roadway: bridge cut tracks overhead across the underpass
      let vi = i;
      let vj = j;
      let ax = vi > 0 ? geo[vi - 1].B.x : geo[0].A.x;
      let az = vi > 0 ? geo[vi - 1].B.z : geo[0].A.z;
      let bx = vj < count ? geo[vj].A.x : geo[count - 1].B.x;
      let bz = vj < count ? geo[vj].A.z : geo[count - 1].B.z;
      let d = Math.hypot(bx - ax, bz - az);
      if (d < 10) {
        if (vi > 0 && Math.hypot(bx - geo[vi - 1].A.x, bz - geo[vi - 1].A.z) >= 10) {
          vi--;
          ax = vi > 0 ? geo[vi - 1].B.x : geo[0].A.x;
          az = vi > 0 ? geo[vi - 1].B.z : geo[0].A.z;
          d = Math.hypot(bx - ax, bz - az);
        } else if (vj < count && Math.hypot(geo[vj].B.x - ax, geo[vj].B.z - az) >= 10) {
          vj++;
          bx = vj < count ? geo[vj].A.x : geo[count - 1].B.x;
          bz = vj < count ? geo[vj].A.z : geo[count - 1].B.z;
          d = Math.hypot(bx - ax, bz - az);
        }
      }
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const isBridgeCorridor = (mz < -150 && mz > -230 && mx > -1380 && mx < -1265) ||
                               (mz > 40 && mz < 160 && mx > -1460 && mx < -1310) ||
                               (mz > 490 && mz < 640 && mx > -1575 && mx < -1330) ||
                               (mx >= -1285 && mx <= -1170 && mz >= -590 && mz <= -500);
      const isRoadOverpass = !isBridgeCorridor && (underDeck(mx, mz) || BRIDGES.some((br) => !br.footbridge &&
        br.name !== 'Most Teatralny' && br.name !== 'Most Uniwersytecki' && br.name !== 'Most Dworcowy' &&
        br.name !== 'Franklina Roosevelta' && br.name !== 'Dworcowa' && br.links && br.links.some((l) => {
        for (let k = 0; k + 1 < l.pts.length; k++) {
          const lax = l.pts[k].x, laz = l.pts[k].z, lbx = l.pts[k + 1].x, lbz = l.pts[k + 1].z;
          const ldx = lbx - lax, ldz = lbz - laz, L2 = ldx * ldx + ldz * ldz || 1e-9;
          const t = Math.max(0, Math.min(1, ((mx - lax) * ldx + (mz - laz) * ldz) / L2));
          if (Math.hypot(lax + t * ldx - mx, laz + t * ldz - mz) < l.width / 2 + 15) return true;
        }
        return false;
      })));
        if (isRoadOverpass) {
          for (let k = i; k < j; k++) {
            const { s0, A, B } = geo[k];
            if (why[k]) dropped[why[k]]--;
            why[k] = null;
            kept[k] = 1;
            pieces.push({ railIndex: tr.railIndex, s0, ax: A.x, az: A.z, bx: B.x, bz: B.z, ground: 0 });
          }
        } else if (d < 120 && d >= 10) {
          const spanPieces = [];
          for (let k = vi; k < vj; k++) {
            why[k] = why[k] || 'viaduct';
            kept[k] = 0;
            spanPieces.push({ ax: geo[k].A.x, az: geo[k].A.z, bx: geo[k].B.x, bz: geo[k].B.z, s0: geo[k].s0 });
          }
          const isBridgeTram = (mz < -150 && mz > -230 && mx > -1380 && mx < -1265) ||
                               (mz > 50 && mz < 150 && mx > -1450 && mx < -1320) ||
                               (mz > 500 && mz < 630 && mx > -1565 && mx < -1335);
          const hasTram = isBridgeTram || spanPieces.some((p) => tramDist((p.ax + p.bx) / 2, (p.az + p.bz) / 2, 5) < 4.5);
          const yClearance = hasTram ? 6.0 : 4.8;
          const deckY = yClearance + 0.35;
          viaducts.push({
            railIndex: tr.railIndex,
            ax, az,
            bx, bz,
            pieces: spanPieces,
            spanLen: d,
            mx, mz,
            hasTram,
            yClearance,
            deckY
          });
        }
      i = vj;
    }
    // End walls where the bed meets a gap (not at the edge of the detail box, nor a level crossing)
    for (let i = 0; i < count; i++) {
      if (!kept[i]) continue;
      const { A, B } = geo[i];
      const len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const dx = (B.x - A.x) / len;
      const dz = (B.z - A.z) / len;
      const ground = blockAt((A.x + B.x) / 2, (A.z + B.z) / 2) ? SW_TOP : 0;
      if (i > 0 && why[i - 1] && why[i - 1] !== 'offLand' && why[i - 1] !== 'level') {
        const viaduct = viaducts.find((v) => v.railIndex === tr.railIndex && Math.hypot(v.bx - A.x, v.bz - A.z) < 0.1);
        ends.push({ x: A.x, z: A.z, dx: -dx, dz: -dz, ground, s: geo[i].s0, inward: 1, tr, viaduct: !!viaduct,
          deckY: viaduct ? viaduct.deckY : null, yClearance: viaduct ? viaduct.yClearance : null });
      }
      if (i + 1 < count && why[i + 1] && why[i + 1] !== 'offLand' && why[i + 1] !== 'level') {
        const viaduct = viaducts.find((v) => v.railIndex === tr.railIndex && Math.hypot(v.ax - B.x, v.az - B.z) < 0.1);
        ends.push({ x: B.x, z: B.z, dx, dz, ground, s: geo[i + 1].s0, inward: -1, tr, viaduct: !!viaduct,
          deckY: viaduct ? viaduct.deckY : null, yClearance: viaduct ? viaduct.yClearance : null });
      }
    }
    keptAt.set(tr.railIndex, kept);
    trackGeo.set(tr.railIndex, { geo, kept });
  }

  for (let pIdx = pieces.length - 1; pIdx >= 0; pIdx--) {
    const pc = pieces[pIdx];
    if (viaducts.some((v) => v.railIndex === pc.railIndex && v.pieces.some((sp) => Math.hypot(sp.ax - pc.ax, sp.az - pc.az) < 0.01))) {
      pieces.splice(pIdx, 1);
    }
  }

  // --- Approach ramps (railway embankments) before and after viaducts ----------------------------------------------
  // Smoothly elevate tracks to viaduct deck height (deckY) over RAMP_LEN (max slope < 6%), preventing 90-degree cliffs
  const RAMP_LEN = 160;
  const viaductsByTrack = new Map();
  for (const v of viaducts) {
    if (!viaductsByTrack.has(v.railIndex)) viaductsByTrack.set(v.railIndex, []);
    viaductsByTrack.get(v.railIndex).push(v);
  }

  const elevationAt = (x, z) => {
    let maxElev = 0;
    for (const v of viaducts) {
      const dist = Math.min(Math.hypot(x - v.ax, z - v.az), Math.hypot(x - v.bx, z - v.bz));
      if (dist < RAMP_LEN) {
        const u = 1 - dist / RAMP_LEN;
        const s = u * u * (3 - 2 * u);
        const elev = v.deckY * s;
        if (elev > maxElev) maxElev = elev;
      }
    }
    return maxElev;
  };

  for (const pc of pieces) {
    const len = Math.hypot(pc.bx - pc.ax, pc.bz - pc.az) || 1;
    const dx = (pc.bx - pc.ax) / len;
    const dz = (pc.bz - pc.az) / len;
    const mx = (pc.ax + pc.bx) / 2;
    const mz = (pc.az + pc.bz) / 2;

    const candidates = [];
    const myV = viaductsByTrack.get(pc.railIndex);
    if (myV) {
      for (const v of myV) {
        const dA = Math.hypot(mx - v.ax, mz - v.az);
        const dB = Math.hypot(mx - v.bx, mz - v.bz);
        if (Math.min(dA, dB) < RAMP_LEN) candidates.push({ v, weight: 1.0 });
      }
    }
    for (const v of viaducts) {
      if (myV && myV.includes(v)) continue;
      const dA = Math.hypot(mx - v.ax, mz - v.az);
      const dB = Math.hypot(mx - v.bx, mz - v.bz);
      const d = Math.min(dA, dB);
      if (d < RAMP_LEN) {
        const vlen = Math.hypot(v.bx - v.ax, v.bz - v.az) || 1;
        const vdx = (v.bx - v.ax) / vlen;
        const vdz = (v.bz - v.az) / vlen;
        const dot = Math.abs(dx * vdx + dz * vdz);
        if (dot >= 0.7) {
          const refP = dA < dB ? { x: v.ax, z: v.az } : { x: v.bx, z: v.bz };
          const latDist = Math.abs((mx - refP.x) * (-vdz) + (mz - refP.z) * vdx);
          if (latDist <= 25) {
            const sLat = 1 - (latDist / 25) * (latDist / 25);
            const sDot = (dot - 0.7) / 0.3;
            candidates.push({ v, weight: sLat * sDot });
          }
        }
      }
    }

    const elevAt = (x, z) => {
      let maxElev = 0;
      for (const { v, weight } of candidates) {
        const dist = Math.min(Math.hypot(x - v.ax, z - v.az), Math.hypot(x - v.bx, z - v.bz));
        if (dist < RAMP_LEN) {
          const u = 1 - dist / RAMP_LEN;
          const s = u * u * (3 - 2 * u);
          const elev = (v.deckY - pc.ground) * s * weight;
          if (elev > maxElev) maxElev = elev;
        }
      }
      return pc.ground + maxElev;
    };

    pc.yA = elevAt(pc.ax, pc.az);
    pc.yB = elevAt(pc.bx, pc.bz);
    pc.yMid = (pc.yA + pc.yB) / 2;
  }
  const keptOn = (tr, s) => {
    const kept = keptAt.get(tr.railIndex);
    return !!kept[Math.min(kept.length - 1, Math.max(0, Math.floor((s / tr.len) * kept.length)))];
  };

  // --- Corridor boundary --------------------------------------------------------------------------------------------
  // For each side of each track: a vertex RAIL_FENCE_O out at every piece joint (mitred on the averaged normal), and a
  // segment over every kept piece whose side is an outer edge (no other track within ~6 m beyond the fence) and whose
  // samples all keep clear: on land, RAIL_FENCE_ROAD outside every roadway (and off road decks), RAIL_MAST_TRAM from
  // every tram track, off every rail bed (3 m from any track centreline, so 0.5 m past a bed's foot)
  const plazaBoxes = PLAZAS.map((pl) => {
    const xs = pl.ring.map((q) => q.x);
    const zs = pl.ring.map((q) => q.z);
    return { pl, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const inPlaza = (x, z) => plazaBoxes.some(({ pl, x0, x1, z0, z1 }) => {
    if (x < x0 || x > x1 || z < z0 || z > z1) return false;
    let inside = false;
    const r = pl.ring;
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      if ((r[i].z > z) !== (r[k].z > z) && x < r[k].x + ((z - r[k].z) * (r[i].x - r[k].x)) / (r[i].z - r[k].z)) inside = !inside;
    }
    return inside;
  });
  const fenceClear = (x, z) => isLand(x, z) && !underDeck(x, z) && roadDist(x, z) >= RAIL_FENCE_ROAD && tramDist(x, z) >= RAIL_MAST_TRAM &&
    railDist(x, z) >= 3;
  const runs = []; // [{ railIndex, side, pts: [{ x, z }], solid: [0|1 per segment], s0 }]
  for (const tr of tracks) {
    const { geo, kept } = trackGeo.get(tr.railIndex);
    const n = geo.length;
    const dirs = geo.map(({ A, B }) => {
      const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      return { dx: (B.x - A.x) / L, dz: (B.z - A.z) / L };
    });
    for (const side of [1, -1]) {
      // vertex k is the joint before piece k (k = n: the end of the last piece)
      const vert = (k) => {
        const a = dirs[Math.max(0, k - 1)];
        const b = dirs[Math.min(n - 1, k)];
        let nx = -(a.dz + b.dz);
        let nz = a.dx + b.dx;
        const L = Math.hypot(nx, nz) || 1;
        nx /= L;
        nz /= L;
        const mitre = Math.max(0.7, nx * -b.dz + nz * b.dx);
        const P = k < n ? geo[k].A : geo[n - 1].B;
        return { x: P.x + (nx * side * RAIL_FENCE_O) / mitre, z: P.z + (nz * side * RAIL_FENCE_O) / mitre };
      };
      let run = null;
      for (let i = 0; i < n; i++) {
        let ok = !!kept[i];
        let solid = 0;
        if (ok) {
          const a = run ? run.pts[run.pts.length - 1] : vert(i);
          const b = vert(i + 1);
          const nx = -dirs[i].dz * side;
          const nz = dirs[i].dx * side;
          // outer edge: no track centre within 5.5 m of a point 3 m beyond the fence (tested first: it rejects most)
          for (const t of [0.5, 0, 1]) {
            const x = a.x + (b.x - a.x) * t + nx * 3;
            const z = a.z + (b.z - a.z) * t + nz * 3;
            if (railDist(x, z, 5.5) < 5.5) ok = false;
            if (!ok) break;
          }
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            if (!ok || !fenceClear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) ok = false;
            if (!ok) break;
          }
          if (ok) {
            // a street, a block, a plaza or open land (the station car parks are unmapped ground) within 12 m beyond:
            // the solid wall; the fence alone between parallel track bundles and along the water
            const mx = (a.x + b.x) / 2;
            const mz = (a.z + b.z) / 2;
            for (const d of [3, 6, 9, 12]) {
              const x = mx + nx * d;
              const z = mz + nz * d;
              if (!isLand(x, z)) continue;
              if (roadDist(x, z) < 0 || blockAt(x, z) || inPlaza(x, z) || (d >= 6 && railDist(x, z, 6) >= 6)) solid = 1;
              if (solid) break;
            }
            if (!run) {
              run = { railIndex: tr.railIndex, side, pts: [a], solid: [], s0: geo[i].s0 };
              runs.push(run);
            }
            run.pts.push(b);
            run.solid.push(solid);
          }
        }
        if (!ok) run = null;
      }
    }
  }
  // Runs meeting end to end across a switch (another track chain) are joined at the midpoint of their ends
  const runEnds = [];
  for (const r of runs) runEnds.push(r.pts[0], r.pts[r.pts.length - 1]);
  const endGrid = segmentGrid(16);
  runEnds.forEach((p, i) => endGrid.add(p.x, p.z, p.x, p.z, i));
  for (let i = 0; i < runEnds.length; i++) {
    const p = runEnds[i];
    const h = endGrid.nearest(p.x, p.z, 2, (sg) => sg.data !== i && sg.data !== (i ^ 1));
    if (!h || h.seg.data < i) continue;
    const q = runEnds[h.seg.data];
    const mx = (p.x + q.x) / 2;
    const mz = (p.z + q.z) / 2;
    p.x = q.x = mx;
    p.z = q.z = mz;
  }
  // Close the visible gaps: a stub from each run end to the nearest other run end or end-wall corner within RAIL_STUB
  // (a switch the snap above missed, a run stopping short of a cut), when the stub itself keeps the boundary's
  // clearances
  const targets = []; // { x, z, run }: run ends (run: the run's index) and end-wall corners (run: -1)
  runs.forEach((r, i) => targets.push({ ...r.pts[0], run: i }, { ...r.pts[r.pts.length - 1], run: i }));
  for (const e of ends) {
    for (const sg of [1, -1]) targets.push({ x: e.x - e.dz * sg * (RAIL_FENCE_O + 0.15), z: e.z + e.dx * sg * (RAIL_FENCE_O + 0.15), run: -1 });
  }
  const targetGrid = segmentGrid(16);
  targets.forEach((t, i) => targetGrid.add(t.x, t.z, t.x, t.z, i));
  const stubRuns = [];
  const stubbed = new Set();
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    if (a.run < 0) continue;
    const h = targetGrid.nearest(a.x, a.z, RAIL_STUB, (sg) => targets[sg.data].run !== a.run);
    if (!h || h.d < 0.3) continue;
    const j = h.seg.data;
    const b = targets[j];
    const pair = Math.min(i, j) * 1e6 + Math.max(i, j);
    if (stubbed.has(pair)) continue;
    let ok = true;
    for (let t = 0; t <= 1 + 1e-9 && ok; t += 0.25 / Math.max(1, h.d)) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      // the stub may touch its own ends' beds only as close as the runs themselves do
      ok = isLand(x, z) && roadDist(x, z) >= RAIL_FENCE_ROAD && tramDist(x, z) >= RAIL_MAST_TRAM && railDist(x, z) >= 3;
    }
    if (!ok) continue;
    stubbed.add(pair);
    const ra = runs[a.run];
    stubRuns.push({ railIndex: ra.railIndex, side: ra.side, pts: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], solid: [ra.solid[0]], s0: 0, stub: true });
  }
  runs.push(...stubRuns);

  const fenceGrid = segmentGrid(32);
  for (const r of runs) {
    for (let k = 0; k + 1 < r.pts.length; k++) fenceGrid.add(r.pts[k].x, r.pts[k].z, r.pts[k + 1].x, r.pts[k + 1].z, r);
  }
  const fenceDist = (x, z, r = 2) => {
    const h = fenceGrid.nearest(x, z, r);
    return h ? h.d : r;
  };

  // --- Overhead line supports ---------------------------------------------------------------------------------------
  // Every track is taken as electrified (PKP 3 kV DC; GEO.rail has no electrified tag)
  const masts = [];
  const arms = [];
  const portals = [];
  const droppers = [];
  const supported = segmentGrid(32);
  const mastAt = (x, z, h) => {
    for (const q of masts) if (Math.abs(q.x - x) < 1.5 && Math.abs(q.z - z) < 1.5) return q;
    const q = { x, z, h };
    masts.push(q);
    return q;
  };
  // On a block only within 3.5 m of its curb: the lots (and their buildings) stand 4.6 m behind it
  const offLots = (x, z) => !blockAt(x, z) || [0, 1, 2, 3, 4, 5, 6, 7].some((k) => {
    const a = (k * Math.PI) / 4;
    return !blockAt(x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5);
  });
  const clear = (x, z) => isLand(x, z) && !underDeck(x, z) && roadDist(x, z) >= RAIL_MAST_ROAD && tramDist(x, z) >= RAIL_MAST_TRAM &&
    railDist(x, z) >= RAIL_KEEP && fenceDist(x, z) >= 0.4 && offLots(x, z);
  // A support line a-b must not reach over a roadway or a tram track
  const spanClear = (ax, az, bx, bz) => {
    if (tramGrid.crossing(ax, az, bx, bz).length) return false;
    const L = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d <= L; d += 1) {
      const t = d / (L || 1);
      if (roadDist(ax + (bx - ax) * t, az + (bz - az) * t) < 0.5) return false;
    }
    return true;
  };
  const march = (x, z, nx, nz, maxO) => {
    for (let o = RAIL_KEEP; o <= maxO; o += 0.25) {
      const px = x + nx * o;
      const pz = z + nz * o;
      if (!isLand(px, pz)) return null;
      if (clear(px, pz)) return { x: px, z: pz, o };
    }
    return null;
  };
  const mark = (x, z, tr) => supported.add(x - 0.1, z, x + 0.1, z, tr);
  // A cantilever mast beside the track at P, else a portal over the yard; false when neither fits
  const support = (tr, P) => {
    const nx = -P.dz;
    const nz = P.dx;
    const sides = [march(P.x, P.z, nx, nz, RAIL_ARM_REACH), march(P.x, P.z, -nx, -nz, RAIL_ARM_REACH)]
      .filter((sd) => sd && spanClear(sd.x, sd.z, P.x, P.z)).sort((a, b) => a.o - b.o);
    if (sides.length) {
      const side = sides[0];
      const q = mastAt(side.x, side.z, 8.2);
      const ux = (P.x - q.x) / side.o;
      const uz = (P.z - q.z) / side.o;
      const arm = { ax: q.x, az: q.z, bx: P.x + ux * 0.3, bz: P.z + uz * 0.3 };
      arms.push(arm);
      for (const c of railGrid.crossing(arm.ax, arm.az, arm.bx, arm.bz)) mark(c.x, c.z, c.seg.data);
      mark(P.x, P.z, tr);
      return true;
    }
    // In a yard: a portal from the first clear spot on each side, its beam carrying every track it crosses
    const PR = march(P.x, P.z, nx, nz, RAIL_PORTAL_REACH);
    const PL = march(P.x, P.z, -nx, -nz, RAIL_PORTAL_REACH);
    if (!PR || !PL || !spanClear(PL.x, PL.z, PR.x, PR.z)) return false;
    const a = mastAt(PL.x, PL.z, 9.6);
    const b = mastAt(PR.x, PR.z, 9.6);
    portals.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    for (const c of railGrid.crossing(a.x, a.z, b.x, b.z)) {
      droppers.push({ x: c.x, z: c.z });
      mark(c.x, c.z, c.seg.data);
    }
    return true;
  };
  // The wire ends at every cut end: a support 1.5 m back from it (or further in, up to 8 m, if none fits there)
  for (const e of ends) {
    if (supported.nearest(e.x, e.z, 3, (sg) => sg.data === e.tr)) continue;
    for (const inset of [1.5, 4, 8]) {
      const s = e.s + e.inward * inset;
      if (!keptOn(e.tr, s)) continue;
      if (support(e.tr, pointAt(e.tr, s))) break;
    }
  }
  for (const tr of tracks) {
    if (tr.len < 30) continue;
    const count = Math.max(1, Math.round(tr.len / RAIL_STATION));
    for (let i = 0; i < count; i++) {
      const s = ((i + 0.5) * tr.len) / count;
      if (!keptOn(tr, s)) continue;
      const P = pointAt(tr, s);
      if (supported.nearest(P.x, P.z, RAIL_STATION * 0.4, (sg) => sg.data === tr)) continue;
      support(tr, P);
    }
  }
  // --- Player keep-out ----------------------------------------------------------------------------------------------
  // A 1 m raster in 64 m tiles: each kept piece's rectangle RAIL_KEEPOUT either side (0.25 m past its ends, under the
  // end walls), and on a side that is not an outer edge (so has no boundary), the ground out to the other track when
  // the way across stays clear of roads and tram tracks (the strips between bundles that are fenced on neither side)
  const tiles = new Map();
  const tileKey = (tx, tz) => (tx + 512) * 1024 + (tz + 512); // small integers (±32 km): fast Map keys
  let corridorCells = 0;
  let lastKey = -1;
  let lastTile = null;
  const fillRect = (ax, az, dx, dz, len, o0, o1) => {
    const nx = -dz;
    const nz = dx;
    const xs = [ax + nx * o0 - dx * 0.25, ax + nx * o1 - dx * 0.25, ax + nx * o0 + dx * (len + 0.25), ax + nx * o1 + dx * (len + 0.25)];
    const zs = [az + nz * o0 - dz * 0.25, az + nz * o1 - dz * 0.25, az + nz * o0 + dz * (len + 0.25), az + nz * o1 + dz * (len + 0.25)];
    for (let iz = Math.floor(Math.min(...zs)); iz <= Math.floor(Math.max(...zs)); iz++) {
      for (let ix = Math.floor(Math.min(...xs)); ix <= Math.floor(Math.max(...xs)); ix++) {
        const cx = ix + 0.5 - ax;
        const cz = iz + 0.5 - az;
        const u = cx * dx + cz * dz;
        const o = cx * nx + cz * nz;
        if (u < -0.25 || u > len + 0.25 || o < o0 || o > o1) continue;
        const k = tileKey(ix >> 6, iz >> 6);
        if (k !== lastKey) {
          lastKey = k;
          lastTile = tiles.get(k);
          if (!lastTile) tiles.set(k, (lastTile = new Uint8Array(KEEPOUT_TILE * KEEPOUT_TILE)));
        }
        const tile = lastTile;
        const c = (ix & 63) + ((iz & 63) << 6);
        if (!tile[c]) corridorCells++;
        tile[c] = 1;
      }
    }
  };
  let bands = 0;
  for (const pc of pieces) {
    const len = Math.hypot(pc.bx - pc.ax, pc.bz - pc.az);
    const dx = (pc.bx - pc.ax) / len;
    const dz = (pc.bz - pc.az) / len;
    fillRect(pc.ax, pc.az, dx, dz, len, -RAIL_KEEPOUT, RAIL_KEEPOUT);
    // In 2 m steps, so a band follows a neighbour that converges or diverges instead of overshooting it
    const steps = Math.max(1, Math.round(len / 2));
    for (const sg of [1, -1]) {
      const nx = -dz * sg;
      const nz = dx * sg;
      for (let q = 0; q < steps; q++) {
        const s0 = (q * len) / steps;
        const s1 = ((q + 1) * len) / steps;
        const px = pc.ax + dx * (s0 + s1) / 2;
        const pz = pc.az + dz * (s0 + s1) / 2;
        // The other track that keeps this side from being an outer edge (the boundary's own test: a track centre
        // within 5.5 m of a point 3 m beyond the fence line), if any
        const h = railGrid.nearest(px + nx * (RAIL_FENCE_O + 3), pz + nz * (RAIL_FENCE_O + 3), 5.5);
        if (!h) continue;
        const reach = (h.qx - px) * nx + (h.qz - pz) * nz;
        // tracks up to 2 × RAIL_KEEPOUT apart already close up (most of a yard)
        if (reach <= 2 * RAIL_KEEPOUT) continue;
        let ok = true;
        for (let o = RAIL_KEEPOUT; o <= reach && ok; o += 1) {
          const x = px + nx * o;
          const z = pz + nz * o;
          ok = isLand(x, z) && roadDist(x, z) >= 3 && tramDist(x, z) >= 2.5;
        }
        if (!ok) continue;
        bands++;
        // the strip between the two rectangles (with 0.5 m of overlap)
        const o0 = RAIL_KEEPOUT - 0.5;
        const o1 = reach - RAIL_KEEPOUT + 0.5;
        fillRect(pc.ax + dx * s0, pc.az + dz * s0, dx, dz, s1 - s0, sg > 0 ? o0 : -o1, sg > 0 ? o1 : -o0);
      }
    }
  }
  const corridor = {
    cells: corridorCells,
    bands,
    // Is (x, z) inside the railway corridor? (allocation-free; ground players may not enter)
    has(x, z) {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const tile = tiles.get(tileKey(ix >> 6, iz >> 6));
      return !!tile && tile[(ix & 63) + ((iz & 63) << 6)] === 1;
    }
  };
  // --- Grade-separated railway crossings -----------------------------------------------------------------------------
  // All railway-roadway intersections (including Św. Michała, Krańcowa, Bałtycka, Gdyńska, Wrzesińska, Libelta)
  // are elevated on viaducts (rail.viaducts). Level crossing barriers and warning signals have been liquidated,
  // making road surfaces 100% collision-free and unobstructed.
  const crossingSites = [];
  const crossings = [];
  const barriers = [];
  const signals = [];

  // Clear corridor keep-out raster cells at level crossings so ground vehicles can pass smoothly:
  const clearCell = (ix, iz) => {
    const k = tileKey(ix >> 6, iz >> 6);
    const tile = tiles.get(k);
    if (!tile) return;
    const c = (ix & 63) + ((iz & 63) << 6);
    if (tile[c]) {
      tile[c] = 0;
      corridorCells--;
    }
  };

  // Clear cells around GEO.levelCrossings points on the roadway
  for (let k = 0; k + 1 < lx.length; k += 2) {
    const cx = lx[k];
    const cz = lx[k + 1];
    for (let iz = Math.floor(cz - 10); iz <= Math.floor(cz + 10); iz++) {
      for (let ix = Math.floor(cx - 10); ix <= Math.floor(cx + 10); ix++) {
        const x = ix + 0.5;
        const z = iz + 0.5;
        if (Math.hypot(x - cx, z - cz) <= 10 && roadDist(x, z) < 3.0) {
          clearCell(ix, iz);
        }
      }
    }
  }

  corridor.cells = corridorCells;

  // Ground footprints (masts, barriers, signals and the boundary sampled every 2 m) for tests/tram-infra.test.cjs's network check
  const footprints = masts.map((q) => ({ minX: q.x - 0.25, maxX: q.x + 0.25, minZ: q.z - 0.25, maxZ: q.z + 0.25 }));
  for (const b of barriers) footprints.push({ minX: b.x - 0.25, maxX: b.x + 0.25, minZ: b.z - 0.25, maxZ: b.z + 0.25 });
  for (const s of signals) footprints.push({ minX: s.x - 0.15, maxX: s.x + 0.15, minZ: s.z - 0.15, maxZ: s.z + 0.15 });
  for (const r of runs) {
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k];
      const b = r.pts[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let j = 0; j <= steps; j++) {
        const x = a.x + ((b.x - a.x) * j) / steps;
        const z = a.z + ((b.z - a.z) * j) / steps;
        footprints.push({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15 });
      }
    }
  }
  return { tracks, pieces, dropped, level, ends, runs, corridor, masts, arms, portals, droppers, footprints, laneDist, roadDist,
    tramDist, railDist, crossings, barriers, signals, viaducts, elevationAt };
}

// --- Rendering ---------------------------------------------------------------------------------------------------------
// Name plate atlas: one 256 x 128 cell per stop name (a yellow "TRAMWAJ" band over the name in white on ZTM green)
const PLATE_CELL = [256, 128];
function createPlateAtlas(names) {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const c = document.createElement('canvas');
  c.width = cols * PLATE_CELL[0];
  c.height = rows * PLATE_CELL[1];
  const ctx = c.getContext('2d');
  names.forEach((name, i) => {
    const x0 = (i % cols) * PLATE_CELL[0];
    const y0 = Math.floor(i / cols) * PLATE_CELL[1];
    ctx.fillStyle = '#0d6b3f';
    ctx.fillRect(x0, y0, PLATE_CELL[0], PLATE_CELL[1]);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(x0 + 6, y0 + 6, PLATE_CELL[0] - 12, 34);
    ctx.fillStyle = '#0d3b24';
    ctx.font = '800 24px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TRAMWAJ', x0 + PLATE_CELL[0] / 2, y0 + 24);
    ctx.fillStyle = '#ffffff';
    let size = 34;
    ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    while (size > 14 && ctx.measureText(name).width > PLATE_CELL[0] - 20) {
      size -= 2;
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    }
    ctx.fillText(name, x0 + PLATE_CELL[0] / 2, y0 + 84);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cols, rows };
}

// Instanced mesh from a list of matrices (and optional per-instance attributes), or null when the list is empty
function instanced(name, geo, mat, matrices, attrs = {}, shadow = true) {
  if (!matrices.length) return null;
  const g = geo.clone();
  for (const [key, { size, data }] of Object.entries(attrs)) {
    g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
  }
  const mesh = new THREE.InstancedMesh(g, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

// Player colliders for the stop furniture. The shelter, sign and machine stand turned with the track, so each is an
// oriented box: the old world AABB flattened the shelter's local depth to hx + hz at 45°, reaching up to 2.28 m past
// the glass on the real stops. The shelter's back face keeps 0.08 m behind the glass at z = -0.62; its front stops at
// +0.7 m, just past the 0.655 m front posts and inside the 0.8 m roof edge (the bench fills the back half, so the open
// side stays blocked under the roof), and its ends match the end panel / advert at hx = len / 2 (2.2 m at 4.4 m); the
// longer roof is above player height.
function stopFurnitureColliders(stops) {
  const colliders = [];
  const box = (x, z, hx, hz, yaw, maxY) => {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY, obb: { cx: x, cz: z, hx, hz, cs, sn } });
  };
  for (const st of stops) {
    if (st.shelter) {
      const { x, y, z, yaw, len } = st.shelter;
      box(x, z, len / 2, 0.7, yaw, y + 2.6);
    }
    if (st.sign) {
      const { x, y, z } = st.sign;
      box(x, z, 0.08, 0.08, 0, y + 3);
    }
    if (st.machine) {
      const { x, y, z, yaw } = st.machine;
      box(x, z, 0.31, 0.24, yaw, y + 1.8);
    }
  }
  return colliders;
}

/**
 * Builds the rails, overhead line and stops into a `TramInfrastructure` group (a scene-culling root, main.js) and
 * returns { group, colliders, stops, railCorridor } (colliders: poles, masts, shelters, signs, machines, end walls and
 * the corridor boundary, for the player only; built after the road network, so nothing here closes a lane;
 * railCorridor(x, z): true inside the railway corridor, which ground players may not enter).
 */
function buildTramInfrastructure(scene, network) {
  const layout = layoutTramInfrastructure(network);
  const { tracks, stops, poles, spans, arms, rosettes, droppers } = layout;
  const group = new THREE.Group();
  group.name = 'TramInfrastructure';
  const colliders = [];
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const M = () => {
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  // Unit box along local x from a to b, w wide (z) and h tall (y), its centre at height y
  const beam = (ax, ay, az, bx, by, bz, w, h, ext = 0) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const L = Math.hypot(dx, dy, dz) + ext;
    dummy.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    dummy.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YZX');
    dummy.scale.set(L, h, w);
    return M();
  };

  // --- Materials ----------------------------------------------------------------------------------------------------
  // Rail heads: polished running surface on top, dark weathered steel on the sides
  const railMat = new THREE.MeshStandardNodeMaterial();
  const top = step(0.5, normalGeometry.y);
  railMat.colorNode = mix(color(0x3d332c), color(0xa9aaa6), top);
  railMat.metalnessNode = mix(float(0.35), float(0.9), top);
  railMat.roughnessNode = mix(float(0.8), float(0.32), top);
  const grooveMat = new THREE.MeshStandardNodeMaterial({ color: 0x141414, roughness: 0.95 });
  // Ballast with concrete sleepers every 0.6 m (per-instance `tie` = piece length, phase along the track). sleeperZ: the
  // sleeper half-length in unit-geometry z; topNy: the normal y above which a face counts as the bed's top
  const createBallastMaterial = (sleeperZ, topNy, side, topStone, sleeperColor) => {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
    mat.colorNode = Fn(() => {
      const tie = attribute('tie', 'vec2');
      const along = positionGeometry.x.add(0.5).mul(tie.x).add(tie.y).div(0.6);
      const fw = max(fwidth(along), 0.0001);
      // box-filtered 40% duty sleepers, fading to their mean coverage once a period is under a couple of pixels
      const pulse = clamp(float(0.2).sub(abs(fract(along).sub(0.5))).div(fw).add(0.5), 0.0, 1.0);
      const sleeper = mix(pulse, float(0.4), smoothstep(0.25, 0.6, fw))
        .mul(step(abs(positionGeometry.z), sleeperZ)).mul(step(topNy, normalGeometry.y));
      const stone = mix(color(side), color(topStone), step(topNy, normalGeometry.y));
      return mix(stone, color(sleeperColor), sleeper);
    })();
    return mat;
  };
  const ballastMat = createBallastMaterial(0.41, 0.5, 0x5d5850, 0x77706a, 0x9b9890);
  // Mainline bed: grey granite with the sleepers' 2.6 m on its 4 m top (RAIL_BED_W at the foot), slopes below
  const railBallastMat = createBallastMaterial(RAIL_SLEEPER / 2 / RAIL_BED_W, 0.95, 0x605c57, 0x7a756e, 0xa3a199);
  const endWallMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a958c, roughness: 0.9 }); // concrete end walls
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0x4f5650, roughness: 0.55, metalness: 0.7 });
  const wireMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b3027, roughness: 0.5, metalness: 0.8 });
  const platformMat = createCurbMaterial();
  const edgeMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8c55a, roughness: 0.7 }); // tactile edge strip
  const frameMat = new THREE.MeshStandardNodeMaterial({ color: 0x2c3330, roughness: 0.45, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb8d0d4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false,
    side: THREE.DoubleSide
  });
  glassMat.mrtNode = transparentEffectMRT;
  // Back-lit advert panel in the shelter's end wall: a pale print by day, lit after dusk (street-details.js lamps'
  // smoothstep on uInteriorGlow)
  const adMat = new THREE.MeshBasicNodeMaterial();
  adMat.colorNode = mix(color(0x6f8c9a), color(0xe8f2ff).mul(1.6), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const machineMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0c419, roughness: 0.45, metalness: 0.3 });
  const screenMat = new THREE.MeshBasicNodeMaterial();
  screenMat.colorNode = mix(color(0x1d2a30), color(0x9fd4ff).mul(1.2), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));

  // --- 1. Rails -----------------------------------------------------------------------------------------------------
  const railM = [];
  const grooveM = [];
  const ballastM = [];
  const ties = [];
  // Off-street track on ballast, narrowed or flush where the roadway comes near (layoutTrackBeds)
  for (const { s0, ax, az, bx, bz, ground, bed } of layout.beds) {
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const ballast = bed > 0;
    const headTop = ballast ? ground + 0.27 : ground + 0.016;
    if (ballast) {
      dummy.position.set(mx, ground + 0.06, mz);
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.scale.set(len + 0.02, 0.16, 2 * bed);
      ballastM.push(M());
      ties.push(len, s0);
    }
    for (const sg of [1, -1]) {
      const o = sg * (GAUGE / 2 + HEAD_W / 2);
      const h = ballast ? 0.17 : 0.05;
      dummy.position.set(mx - dz * o, headTop - h / 2, mz + dx * o);
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.scale.set(len + 0.03, h, HEAD_W);
      railM.push(M());
      if (!ballast) {
        const og = sg * (GAUGE / 2 - GROOVE_W / 2);
        dummy.position.set(mx - dz * og, headTop - 0.002 - 0.02, mz + dx * og);
        dummy.scale.set(len + 0.03, 0.04, GROOVE_W);
        grooveM.push(M());
      }
    }
  }

  // --- 2. Overhead line ---------------------------------------------------------------------------------------------
  const poleM = [];
  const wireM = [];
  const spanM = [];
  const armM = [];
  const rosetteM = [];
  for (const q of poles) {
    dummy.position.set(q.x, q.h / 2, q.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, q.h, 1);
    poleM.push(M());
    colliders.push({ minX: q.x - 0.16, maxX: q.x + 0.16, minZ: q.z - 0.16, maxZ: q.z + 0.16, maxY: q.h });
  }
  for (const sp of spans) spanM.push(beam(sp.ax, SPAN_Y + 0.15, sp.az, sp.bx, SPAN_Y + 0.15, sp.bz, 0.018, 0.018));
  for (const a of arms) {
    armM.push(beam(a.ax, SPAN_Y, a.az, a.bx, SPAN_Y, a.bz, 0.07, 0.07));
    // diagonal stay from higher up the pole to the arm's middle
    armM.push(beam(a.ax, SPAN_Y + 0.9, a.az, (a.ax + a.bx) / 2, SPAN_Y, (a.az + a.bz) / 2, 0.035, 0.035));
  }
  for (const r of rosettes) {
    dummy.position.set(r.x, SPAN_Y + 0.15, r.z);
    dummy.rotation.set(0, Math.atan2(r.nx, r.nz), 0);
    dummy.scale.set(1, 1, 1);
    rosetteM.push(M());
  }
  for (const d of droppers) wireM.push(beam(d.x, WIRE_Y, d.z, d.x, d.y0 + 0.15, d.z + 0.0001, 0.012, 0.012));
  // Contact wire: straight runs along each track, one piece per polyline segment (split at ~STATION)
  for (const tr of tracks) {
    for (let k = 0; k + 1 < tr.n; k++) {
      const ax = tr.p[2 * k];
      const az = tr.p[2 * k + 1];
      const bx = tr.p[2 * k + 2];
      const bz = tr.p[2 * k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05 || !isLand((ax + bx) / 2, (az + bz) / 2)) continue;
      const parts = Math.max(1, Math.ceil(L / STATION));
      for (let j = 0; j < parts; j++) {
        const t0 = j / parts;
        const t1 = (j + 1) / parts;
        wireM.push(beam(ax + (bx - ax) * t0, WIRE_Y, az + (bz - az) * t0, ax + (bx - ax) * t1, WIRE_Y, az + (bz - az) * t1, 0.022, 0.022));
      }
    }
  }

  // --- 2b. Mainline railway ----------------------------------------------------------------------------------------
  // Rail heads, wires, masts and arms join the tram meshes above (same geometry and material, no extra draw calls);
  // only the beds and the end walls are meshes of their own
  const rail = layoutRailInfrastructure(network);
  const railBedM = [];
  const railTies = [];
  const endWallM = [];
  const viaductGirderM = [];
  for (const pc of rail.pieces) {
    const len = Math.hypot(pc.bx - pc.ax, pc.bz - pc.az);
    const dx = (pc.bx - pc.ax) / len;
    const dz = (pc.bz - pc.az) / len;
    const mx = (pc.ax + pc.bx) / 2;
    const mz = (pc.az + pc.bz) / 2;
    const dy = pc.yB - pc.yA;
    const len3D = Math.hypot(len, dy);
    const pitch = Math.atan2(dy, len);
    dummy.rotation.set(0, Math.atan2(-dz, dx), pitch, 'YZX');
    // Beds of neighbouring tracks overlap at switches: a few mm per track keeps their tops from z-fighting
    const bedTop = pc.yMid + RAIL_BED_TOP + (pc.railIndex % 5) * 0.004;
    const bedBottom = pc.ground - 0.06;
    const bedH = bedTop - bedBottom;
    dummy.position.set(mx, (bedBottom + bedTop) / 2, mz);
    dummy.scale.set(len3D + 0.02, bedH, RAIL_BED_W);
    railBedM.push(M());
    railTies.push(len3D, pc.s0);
    const isRiverBridge = RAIL_BRIDGES.some((br) => br.links.some((l) => {
      for (let s = 0; s + 1 < l.pts.length; s++) {
        const a = l.pts[s], b = l.pts[s + 1];
        const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((mx - a.x) * ex + (mz - a.z) * ez) / L2));
        if (Math.hypot(a.x + t * ex - mx, a.z + t * ez - mz) <= l.width * 0.5 + 2) return true;
      }
      return false;
    }));
    if (isRiverBridge) {
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.position.set(mx, -0.175, mz);
      dummy.scale.set(len + 0.05, 0.35, RAIL_BED_W);
      endWallM.push(M());
      for (const sg of [1, -1]) {
        const o = sg * (RAIL_BED_W / 2 + 0.1);
        dummy.position.set(mx - dz * o, 0.6, mz + dx * o);
        dummy.scale.set(len + 0.05, 1.2, 0.22);
        viaductGirderM.push(M());
      }
      if (Math.floor(pc.s0 / 16) !== Math.floor((pc.s0 + len) / 16)) {
        const pierH = 3.0 - 0.35;
        dummy.position.set(mx, -3.0 + pierH / 2, mz);
        dummy.scale.set(2.4, pierH, RAIL_BED_W + 0.6);
        endWallM.push(M());
      }
    }
    const topA = pc.yA + RAIL_BED_TOP + (pc.railIndex % 5) * 0.004;
    const topB = pc.yB + RAIL_BED_TOP + (pc.railIndex % 5) * 0.004;
    for (const sg of [1, -1]) {
      const o = sg * (GAUGE / 2 + HEAD_W / 2);
      const ax = pc.ax - dz * o;
      const az = pc.az + dx * o;
      const bx = pc.bx - dz * o;
      const bz = pc.bz + dx * o;
      railM.push(beam(ax, topA + RAIL_HEAD_H / 2, az, bx, topB + RAIL_HEAD_H / 2, bz, HEAD_W, RAIL_HEAD_H, 0.02));
    }
  }
  // Level crossings: the heads flush with the road (or the sidewalk) and a flangeway groove inside each, as on the
  // street-running tram track; no bed
  for (const pc of rail.level) {
    const len = Math.hypot(pc.bx - pc.ax, pc.bz - pc.az);
    const dx = (pc.bx - pc.ax) / len;
    const dz = (pc.bz - pc.az) / len;
    const mx = (pc.ax + pc.bx) / 2;
    const mz = (pc.az + pc.bz) / 2;
    const top = pc.ground + RAIL_LEVEL_TOP;
    dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
    for (const sg of [1, -1]) {
      const o = sg * (GAUGE / 2 + HEAD_W / 2);
      dummy.position.set(mx - dz * o, top - 0.025, mz + dx * o);
      dummy.scale.set(len + 0.03, 0.05, HEAD_W);
      railM.push(M());
      const og = sg * (GAUGE / 2 - GROOVE_W / 2);
      dummy.position.set(mx - dz * og, top - 0.022, mz + dx * og);
      dummy.scale.set(len + 0.03, 0.04, GROOVE_W);
      grooveM.push(M());
    }
  }
  // End walls: a 0.5 m concrete wall across the corridor (bed and boundary) at each cut, standing just into the gap.
  // At viaducts the abutment wall stands under the deck (from ground to yClearance), acting as the retaining wall
  // of the ramp embankment, while overhead the tracks and trains run unobstructed across the underpass
  for (const e of rail.ends) {
    const cx = e.x + e.dx * 0.25;
    const cz = e.z + e.dz * 0.25;
    const w = 2 * (RAIL_FENCE_O + 0.15); // reaching the corridor boundary on both sides
    const h = e.viaduct ? e.yClearance : e.ground + RAIL_END_H;
    dummy.position.set(cx, (h - 0.1) / 2, cz);
    dummy.rotation.set(0, Math.atan2(-e.dz, e.dx), 0);
    dummy.scale.set(0.5, h + 0.1, w);
    endWallM.push(M());
    // buildingContact's frame: lx = dx·cs - dz·sn along the track, lz across it
    const ex = Math.abs(e.dx) * 0.25 + Math.abs(e.dz) * w / 2;
    const ez = Math.abs(e.dz) * 0.25 + Math.abs(e.dx) * w / 2;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: h,
      obb: { cx, cz, hx: 0.25, hz: w / 2, cs: e.dx, sn: -e.dz } });
  }
  // Viaduct spans: raised steel plate girders, deck slab and tracks bridging cut tracks over roadways
  for (const v of rail.viaducts || []) {
    for (const p of v.pieces) {
      const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
      if (len < 0.01) continue;
      const dx = (p.bx - p.ax) / len;
      const dz = (p.bz - p.az) / len;
      const mx = (p.ax + p.bx) / 2;
      const mz = (p.az + p.bz) / 2;
      const rotY = Math.atan2(-dz, dx);

      // Deck slab (concrete/steel deck carrying ballast)
      dummy.rotation.set(0, rotY, 0);
      dummy.position.set(mx, v.yClearance + 0.175, mz);
      dummy.scale.set(len + 0.05, 0.35, RAIL_BED_W);
      endWallM.push(M());

      // Side plate girders (through-plate girders flanking the track on both sides)
      for (const sg of [1, -1]) {
        const o = sg * (RAIL_BED_W / 2 + 0.1);
        dummy.position.set(mx - dz * o, v.yClearance + 0.6, mz + dx * o);
        dummy.scale.set(len + 0.05, 1.2, 0.22);
        viaductGirderM.push(M());
      }

      // Ballast and rails across the deck, matching approach ramp top height
      const topBallast = v.deckY + RAIL_BED_TOP;
      dummy.position.set(mx, (v.deckY + topBallast) / 2, mz);
      dummy.scale.set(len + 0.05, RAIL_BED_TOP, RAIL_BED_TOP_W);
      railBedM.push(M());
      railTies.push(len, p.s0 ?? 0);

      // Two steel rails
      const topRail = topBallast;
      for (const sg of [1, -1]) {
        const o = sg * (GAUGE / 2 + HEAD_W / 2);
        dummy.position.set(mx - dz * o, topRail + RAIL_HEAD_H / 2, mz + dx * o);
        dummy.scale.set(len + 0.05, RAIL_HEAD_H, HEAD_W);
        railM.push(M());
      }

      // Overhead collider for the bridge span: clearance under it for cars/pedestrians, solid deck overhead
      const hx = len / 2;
      const hz = RAIL_BED_W / 2 + 0.2;
      const ex = Math.abs(dx) * hx + Math.abs(dz) * hz;
      const ez = Math.abs(dz) * hx + Math.abs(dx) * hz;
      colliders.push({
        minX: mx - ex, maxX: mx + ex, minZ: mz - ez, maxZ: mz + ez,
        minY: v.yClearance, maxY: v.yClearance + 2.5,
        obb: { cx: mx, cz: mz, hx, hz, cs: dx, sn: -dz }
      });
    }
  }
  // Corridor boundary: per segment a concrete plinth (or the solid wall) in the end walls' mesh and a masked fence plane
  // on top; one oriented collider per segment up to the fence top
  const fenceM = [];
  const fenceAttr = [];
  for (const r of rail.runs) {
    let s = r.s0;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k];
      const b = r.pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const ground = blockAt(mx, mz) ? SW_TOP : 0;
      const h = r.solid[k] ? RAIL_WALL_H : RAIL_PLINTH_H;
      const t = r.solid[k] ? 0.3 : 0.22;
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.position.set(mx, ground + (h - 0.1) / 2, mz);
      dummy.scale.set(len + 0.04, h + 0.1, t);
      endWallM.push(M());
      dummy.position.set(mx, ground + h + RAIL_FENCE_H / 2, mz);
      dummy.scale.set(len, RAIL_FENCE_H, 1);
      fenceM.push(M());
      fenceAttr.push(len, s);
      s += len;
      const hx = len / 2;
      const hz = t / 2;
      const ex = Math.abs(dx) * hx + Math.abs(dz) * hz;
      const ez = Math.abs(dz) * hx + Math.abs(dx) * hz;
      colliders.push({ minX: mx - ex, maxX: mx + ex, minZ: mz - ez, maxZ: mz + ez, maxY: ground + h + RAIL_FENCE_H,
        obb: { cx: mx, cz: mz, hx, hz, cs: dx, sn: -dz } });
    }
  }
  // Welded-mesh panels (vertical wires every 5 cm, horizontal every 20 cm) between posts every 2.5 m, with a top and a
  // bottom rail. Wires under a pixel's footprint give way to an ordered 2x2 screen-door at ~25% cover, so far fences
  // read as a grey veil instead of shimmering or filling in solid. Per-instance `fence` = (segment length, arc length
  // along its run) keeps the posts' rhythm across segments.
  const fenceMat = new THREE.MeshStandardNodeMaterial({ color: 0x506157, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  fenceMat.maskNode = Fn(() => {
    const f = attribute('fence', 'vec2');
    const along = positionGeometry.x.add(0.5).mul(f.x).add(f.y);
    const up = positionGeometry.y.add(0.5).mul(RAIL_FENCE_H);
    const fa = max(fwidth(along), 0.0001);
    const fu = max(fwidth(up), 0.0001);
    const bar = (d, half, fw) => step(d, max(half, fw.mul(0.5)));
    const post = bar(abs(fract(along.div(2.5).add(0.5)).sub(0.5)).mul(2.5), 0.03, fa);
    const rails = max(bar(abs(up.sub(RAIL_FENCE_H - 0.03)), 0.025, fu), bar(abs(up.sub(0.05)), 0.02, fu));
    const wires = max(
      step(abs(fract(along.div(0.05).add(0.5)).sub(0.5)).mul(0.05), 0.002),
      step(abs(fract(up.div(0.2).add(0.5)).sub(0.5)).mul(0.2), 0.0025)
    );
    const far = smoothstep(0.004, 0.012, fa);
    // 2x2 ordered thresholds 0.125, 0.375, 0.625, 0.875
    const door = fract(floor(screenCoordinate.x).mul(0.5)).add(fract(floor(screenCoordinate.y).mul(0.5)).mul(0.5)).add(0.125);
    const cover = mix(wires, step(door, 0.25), far);
    return max(max(post, rails), cover).greaterThan(0.5);
  })();
  // Contact and messenger wires: straight runs over up to three consecutive pieces of a track (supports stand ~55 m
  // apart, so the real wire is a polygon too), broken where a piece was dropped
  for (let i = 0; i < rail.pieces.length;) {
    let j = i;
    while (j + 1 < rail.pieces.length && j - i < 2 && rail.pieces[j + 1].railIndex === rail.pieces[i].railIndex &&
      Math.hypot(rail.pieces[j + 1].ax - rail.pieces[j].bx, rail.pieces[j + 1].az - rail.pieces[j].bz) < 0.05) j++;
    const a = rail.pieces[i];
    const b = rail.pieces[j];
    for (const y of [RAIL_WIRE_Y, RAIL_MESSENGER_Y]) wireM.push(beam(a.ax, a.yA + y, a.az, b.bx, b.yB + y, b.bz, 0.02, 0.02));
    i = j + 1;
  }
  // Catenary wires across viaduct spans
  for (const v of rail.viaducts || []) {
    for (const p of v.pieces) {
      for (const y of [RAIL_WIRE_Y, RAIL_MESSENGER_Y]) {
        wireM.push(beam(p.ax, v.deckY + y, p.az, p.bx, v.deckY + y, p.bz, 0.02, 0.02));
      }
    }
  }
  // Masts: 0.3 m steel box sections (0.45 m under portals), joining the tram arms' mesh
  for (const q of rail.masts) {
    const yElev = rail.elevationAt ? rail.elevationAt(q.x, q.z) : 0;
    const h = q.h + yElev;
    const w = q.h > 9 ? 0.45 : 0.3;
    dummy.position.set(q.x, h / 2, q.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(w, h, w);
    armM.push(M());
    colliders.push({ minX: q.x - w / 2, maxX: q.x + w / 2, minZ: q.z - w / 2, maxZ: q.z + w / 2, maxY: h });
  }
  for (const a of rail.arms) {
    // a sloping tube from high on the mast to the messenger over the track, a registration arm to the contact wire
    // below it, and a dropper between the two wires
    const yElev = rail.elevationAt ? rail.elevationAt(a.bx, a.bz) : 0;
    armM.push(beam(a.ax, yElev + RAIL_MESSENGER_Y + 0.6, a.az, a.bx, yElev + RAIL_MESSENGER_Y, a.bz, 0.06, 0.06));
    armM.push(beam(a.ax, yElev + RAIL_WIRE_Y - 0.3, a.az, a.bx, yElev + RAIL_WIRE_Y, a.bz, 0.05, 0.05));
    wireM.push(beam(a.bx, yElev + RAIL_WIRE_Y, a.bz, a.bx, yElev + RAIL_MESSENGER_Y, a.bz + 0.0001, 0.012, 0.012));
  }
  for (const p of rail.portals) {
    armM.push(beam(p.ax, 8.9, p.az, p.bx, 8.9, p.bz, 0.35, 0.5));
  }
  for (const d of rail.droppers) wireM.push(beam(d.x, RAIL_WIRE_Y, d.z, d.x, 8.65, d.z + 0.0001, 0.015, 0.015));
  const railBedGeo = unitBox.clone();
  {
    // trapezoid: the top face narrowed to RAIL_BED_TOP_W, flat normals per face (BoxGeometry shares no vertices)
    const pos = railBedGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setZ(i, pos.getZ(i) * RAIL_BED_TOP_W / RAIL_BED_W);
    railBedGeo.computeVertexNormals();
  }
  for (const mesh of [
    instanced('TramRails', unitBox, railMat, railM, {}, false),
    instanced('TramRailGrooves', unitBox, grooveMat, grooveM, {}, false),
    instanced('TramBallast', unitBox, ballastMat, ballastM, { tie: { size: 2, data: ties } }, false)
  ]) if (mesh) group.add(mesh);
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.15, 1, 10).toNonIndexed(),
    new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10).translate(0, 0.5, 0).toNonIndexed()
  ]);
  const rosetteGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, 0.04);
  for (const mesh of [
    instanced('CatenaryPoles', poleGeo, steelMat, poleM),
    instanced('CatenaryWires', unitBox, wireMat, wireM, {}, false),
    instanced('CatenarySpans', unitBox, wireMat, spanM, {}, false),
    instanced('CatenaryArms', unitBox, steelMat, armM),
    instanced('CatenaryRosettes', rosetteGeo, steelMat, rosetteM, {}, false)
  ]) if (mesh) group.add(mesh);
  for (const mesh of [
    instanced('RailBallast', railBedGeo, railBallastMat, railBedM, { tie: { size: 2, data: railTies } }, false),
    instanced('RailEndWalls', unitBox, endWallMat, endWallM),
    instanced('RailFence', new THREE.PlaneGeometry(1, 1), fenceMat, fenceM, { fence: { size: 2, data: fenceAttr } }, false),
    instanced('RailViaductGirders', unitBox, steelMat, viaductGirderM)
  ]) if (mesh) group.add(mesh);

  // --- 2c. Level crossings (barriers & warning signals) -------------------------------------------------------------
  const barrierCabinetM = [];
  const barrierBoomM = [];
  const boomLens = [];
  const signalMastM = [];
  const stAndrewCrossM = [];
  const signalLampM = [];

  const barrierCabinetMat = new THREE.MeshStandardNodeMaterial({ color: 0x82888c, roughness: 0.5, metalness: 0.4 });
  const barrierBoomMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.1 });
  barrierBoomMat.colorNode = Fn(() => {
    const along = positionGeometry.x.mul(attribute('armLen', 'float'));
    const stripe = step(0.5, fract(along.div(0.6)));
    return mix(color(0xf5f5f5), color(0xd41111), stripe);
  })();
  const stAndrewMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  stAndrewMat.colorNode = Fn(() => {
    const edgeY = step(0.042, abs(positionGeometry.y));
    const edgeX = step(0.48, abs(positionGeometry.x));
    const border = max(edgeY, edgeX);
    return mix(color(0xf5f5f5), color(0xd41111), border);
  })();
  const signalLampMat = new THREE.MeshBasicNodeMaterial({ color: 0xee1515 });

  const barrierCabinetGeo = mergeGeometries([
    new THREE.BoxGeometry(0.44, 1.15, 0.4).translate(0, 0.575, 0),
    new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10).rotateZ(Math.PI / 2).translate(0, 0.95, 0.2),
    new THREE.BoxGeometry(0.32, 0.22, 0.28).translate(0, 0.95, -0.2)
  ].map((g) => g.toNonIndexed()));

  const barrierBoomGeo = new THREE.BoxGeometry(1, 0.12, 0.07).translate(0.5, 0, 0);

  const signalMastGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.045, 0.05, 2.9, 10).translate(0, 1.45, 0),
    new THREE.BoxGeometry(0.58, 0.05, 0.05).translate(0, 2.05, 0.02),
    new THREE.CylinderGeometry(0.105, 0.105, 0.08, 12).rotateX(Math.PI / 2).translate(-0.22, 2.05, 0.04),
    new THREE.CylinderGeometry(0.105, 0.105, 0.08, 12).rotateX(Math.PI / 2).translate(0.22, 2.05, 0.04)
  ].map((g) => g.toNonIndexed()));

  const stAndrewCrossGeo = mergeGeometries([
    new THREE.BoxGeometry(1.1, 0.11, 0.02).rotateZ(0.61).translate(0, 2.5, 0.03),
    new THREE.BoxGeometry(1.1, 0.11, 0.02).rotateZ(-0.61).translate(0, 2.5, 0.03)
  ].map((g) => g.toNonIndexed()));

  const signalLampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12).rotateX(Math.PI / 2).translate(-0.22, 2.05, 0.05),
    new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12).rotateX(Math.PI / 2).translate(0.22, 2.05, 0.05)
  ]);

  for (const b of rail.barriers) {
    const y0 = b.y ?? (blockAt(b.x, b.z) ? SW_TOP : 0);
    dummy.position.set(b.x, y0, b.z);
    dummy.rotation.set(0, b.yaw, 0);
    dummy.scale.set(1, 1, 1);
    barrierCabinetM.push(M());

    dummy.position.set(b.x, y0 + 0.95, b.z);
    dummy.rotation.set(0, b.armYaw, 1.43, 'YXZ');
    dummy.scale.set(b.armLen, 1, 1);
    barrierBoomM.push(M());
    boomLens.push(b.armLen);

    colliders.push({ minX: b.x - 0.25, maxX: b.x + 0.25, minZ: b.z - 0.25, maxZ: b.z + 0.25, maxY: y0 + 1.2 });
  }

  for (const s of rail.signals) {
    const y0 = s.y ?? (blockAt(s.x, s.z) ? SW_TOP : 0);
    dummy.position.set(s.x, y0, s.z);
    dummy.rotation.set(0, s.yaw, 0);
    dummy.scale.set(1, 1, 1);
    const m = M();
    signalMastM.push(m);
    stAndrewCrossM.push(m);
    signalLampM.push(m);

    colliders.push({ minX: s.x - 0.15, maxX: s.x + 0.15, minZ: s.z - 0.15, maxZ: s.z + 0.15, maxY: y0 + 2.9 });
  }

  for (const mesh of [
    instanced('CrossingBarrierCabinets', barrierCabinetGeo, barrierCabinetMat, barrierCabinetM),
    instanced('CrossingBarrierBooms', barrierBoomGeo, barrierBoomMat, barrierBoomM, { armLen: { size: 1, data: boomLens } }),
    instanced('CrossingSignalMasts', signalMastGeo, steelMat, signalMastM),
    instanced('CrossingStAndrewCrosses', stAndrewCrossGeo, stAndrewMat, stAndrewCrossM),
    instanced('CrossingSignalLamps', signalLampGeo, signalLampMat, signalLampM, {}, false)
  ]) if (mesh) group.add(mesh);

  // --- 3. Stops -----------------------------------------------------------------------------------------------------
  const platformM = [];
  const edgeM = [];
  const frameM = [];
  const glassM = [];
  const adM = [];
  const signPoleM = [];
  const plateM = [];
  const plateCells = [];
  const machineM = [];
  const screenM = [];
  const names = [...new Set(stops.map((s) => s.name))].sort();
  const atlas = createPlateAtlas(names);
  const trackByRail = new Map(tracks.map((tr) => [tr.railIndex, tr]));
  for (const st of stops) {
    if (st.platform) {
      const tr = trackByRail.get(st.railIndex);
      const { s0, s1, o0, o1 } = st.platform;
      const n = Math.max(1, Math.ceil((s1 - s0) / 3));
      const om = (o0 + o1) / 2;
      const w = Math.abs(o1 - o0);
      const oe = o0 + Math.sign(o1 - o0) * 0.25; // tactile strip along the track-side edge
      for (let i = 0; i < n; i++) {
        const A = pointAt(tr, s0 + ((s1 - s0) * i) / n);
        const B = pointAt(tr, s0 + ((s1 - s0) * (i + 1)) / n);
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        const dx = (B.x - A.x) / len;
        const dz = (B.z - A.z) / len;
        const mx = (A.x + B.x) / 2;
        const mz = (A.z + B.z) / 2;
        dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
        dummy.position.set(mx - dz * om, PLATFORM_H / 2 - 0.05, mz + dx * om);
        dummy.scale.set(len + 0.05, PLATFORM_H + 0.1, w);
        platformM.push(M());
        dummy.position.set(mx - dz * oe, PLATFORM_H + 0.002, mz + dx * oe);
        dummy.scale.set(len + 0.05, 0.006, 0.4);
        edgeM.push(M());
      }
    }
    if (st.shelter) {
      const { x, y, z, yaw, len } = st.shelter;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(len / 4.4, 1, 1);
      const m = M();
      frameM.push(m);
      glassM.push(m);
      adM.push(m);
    }
    if (st.sign) {
      const { x, y, z, yaw } = st.sign;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      const m = M();
      signPoleM.push(m);
      plateM.push(m);
      const i = names.indexOf(st.name);
      plateCells.push(i % atlas.cols, Math.floor(i / atlas.cols));
    }
    if (st.machine) {
      const { x, y, z, yaw } = st.machine;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      const m = M();
      machineM.push(m);
      screenM.push(m);
    }
  }
  colliders.push(...stopFurnitureColliders(stops));
  // Shelter (local: 4.4 m along x, open front facing +z, back wall at z = -0.6): four posts, a roof slab, a glass back
  // wall and end panels, one end holding a lit advert, and a bench
  const shelterFrameGeo = mergeGeometries([
    ...[-2.15, 2.15].flatMap((x) => [-0.62, 0.62].map((z) => new THREE.BoxGeometry(0.07, 2.45, 0.07).translate(x, 1.225, z))),
    new THREE.BoxGeometry(4.6, 0.1, 1.6).translate(0, 2.5, 0),
    new THREE.BoxGeometry(2.4, 0.06, 0.4).translate(0, 0.46, -0.38),
    new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(-1, 0.23, -0.38),
    new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(1, 0.23, -0.38)
  ].map((g) => g.toNonIndexed()));
  const shelterGlassGeo = mergeGeometries([
    new THREE.PlaneGeometry(4.2, 2.1).translate(0, 1.2, -0.62),
    new THREE.PlaneGeometry(1.2, 2.1).rotateY(Math.PI / 2).translate(-2.15, 1.2, 0)
  ]);
  const shelterAdGeo = new THREE.BoxGeometry(0.1, 1.75, 1.2).translate(2.15, 1.15, 0);
  // Stop sign: a pole with the name plate across the top (both faces), standing along the track
  const signPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8).translate(0, 1.45, 0);
  const plateGeo = mergeGeometries([
    new THREE.PlaneGeometry(0.8, 0.4).translate(0, 2.65, 0.035),
    new THREE.PlaneGeometry(0.8, 0.4).rotateY(Math.PI).translate(0, 2.65, -0.035)
  ]);
  const plateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  const cell = attribute('plateCell', 'vec2');
  // canvas row 0 is the texture's top (flipY)
  plateMat.colorNode = texture(atlas.tex, uv().add(vec2(cell.x, float(atlas.rows - 1).sub(cell.y))).div(vec2(atlas.cols, atlas.rows)));
  const plateBackGeo = new THREE.BoxGeometry(0.82, 0.42, 0.06).translate(0, 2.65, 0);
  const machineGeo = mergeGeometries([
    new THREE.BoxGeometry(0.55, 1.6, 0.4).translate(0, 0.8, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.62, 0.08, 0.48).translate(0, 1.64, 0).toNonIndexed()
  ]);
  const screenGeo = new THREE.PlaneGeometry(0.34, 0.26).translate(0, 1.3, 0.201);
  for (const mesh of [
    instanced('TramPlatforms', unitBox, platformMat, platformM),
    instanced('TramPlatformEdges', unitBox, edgeMat, edgeM, {}, false),
    instanced('TramShelterFrames', shelterFrameGeo, frameMat, frameM),
    instanced('TramShelterGlass', shelterGlassGeo, glassMat, glassM, {}, false),
    instanced('TramShelterAdverts', shelterAdGeo, adMat, adM, {}, false),
    instanced('TramStopSignPoles', signPoleGeo, frameMat, signPoleM),
    instanced('TramStopPlateBacks', plateBackGeo, frameMat, plateM),
    instanced('TramStopPlates', plateGeo, plateMat, plateM, { plateCell: { size: 2, data: plateCells } }, false),
    instanced('TicketMachines', machineGeo, machineMat, machineM),
    instanced('TicketMachineScreens', screenGeo, screenMat, screenM, {}, false)
  ]) if (mesh) group.add(mesh);

  scene.add(group);
  const publicStops = stops.map(({ name, x, z, heading, railIndex, s, dir, side, kind }) => ({ name, x, z, heading, railIndex, s, dir, side, kind }));
  console.info(`[tram-infra] ${tracks.length} tracks, ${poles.length} poles, ${spans.length} span wires, ${arms.length} arms, ` +
    `${rosettes.length} rosettes; ${stops.length} stops (${stops.filter((s) => s.kind === 'island').length} islands) ` +
    `of ${GEO.tramStops.length} stop nodes; rail: ${rail.tracks.length} tracks, ${railBedM.length} bed pieces, ` +
    `${rail.ends.length} end walls, ${fenceM.length} boundary segments, ${rail.masts.length} masts, ${rail.arms.length} cantilevers, ${rail.portals.length} portals, ` +
    `${rail.viaducts.length} viaduct spans (${rail.crossings.length} level crossings)`);
  // railCorridor(x, z): the ground players' keep-out (controllers.js), true inside the railway corridor
  return { group, colliders, stops: publicStops, railCorridor: rail.corridor.has };
}

export { layoutTramInfrastructure, layoutRailInfrastructure, buildTramInfrastructure, stopFurnitureColliders };
