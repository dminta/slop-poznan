import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';
import { signalPhase } from './city-config.js';
import { cityUniforms } from './tsl-materials.js';
import { buildTramSectionGeometry, buildTramBellowsGeometry, createTramMaterial } from './actor-models.js';
import { HEADLIGHTS, tramLightSpec, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';

// js/trams.js
// Poznań trams (docs/poznan-plan.md Phase 9) on the tram track graph from GEO.rail, modelled on createHighwayTraffic in
// traffic.js: every tram drives its own path of track edges with the IDM, never changes track and is posed from arc
// length. On top of that:
// - Track graph: the tram chains (cut at every switch and crossing by the geodata build, so chain ends with equal
//   coordinates are the junctions) become directed edges, one-way chains one way and the others both ways. At a node a
//   tram may continue onto an edge whose start tangent is within SWITCH_TURN of its own end tangent (a switch or a
//   crossing, never a reversal); it picks one of them at random when its path is extended. A dead end (mostly the
//   edges of the detail box, some depot stubs) is a buffer stop: the tram stops there and is respawned elsewhere.
// - Stops: GEO.tramStops snapped to the nearest track(s) within STOP_SNAP m; a tram brakes for a virtual stopped
//   leader so that its middle stands at the stop, dwells 20–30 s with its doors open, then departs.
// - Signals: the signalised road junctions (road-network.js) within SIGNAL_REACH m of a track hold trams at a stop
//   line on red & amber, on the same clock and groups as the cars (signalPhase in city-config.js).
// - Following: per tram, the IDM acceleration is the minimum over the free road, the trams ahead on its path (and
//   head-on on two-way track), the switches and crossings ahead that another tram holds or reaches first, the next
//   stop, red signals, curves (speed limit from the lateral acceleration) and a dead end.
// - Bodies: articulated sections (TRAM_MODELS) each posed on the chord between its two ends on the path, so the
//   sections bend round curves and stay joined; bellows between them. One instanced mesh per section kind.
// - Population: a fixed pool of NUM_TRAMS kept within TRAM_RADIUS of the camera, like the street traffic.
// - Mixed traffic: mapTramsToRoads works out once where the track runs over car lanes and junction curves, for
//   traffic.js to make the cars yield (and pedestrians wait); the trams themselves only brake for the cars and the
//   player still in their swept path ahead.
//
// Public surface (docs/actors.md "Trams"): createTramSystem(scene, { network, traffic }) returns { group, update, trams,
// pool, graph, stops, signals, models }; update(dt, elapsed, focus, camera, playerEntity, activeMode). `trams` holds
// the active tram entities, refreshed every update.

const NUM_TRAMS = 24;
const TRAM_HALF_WIDTH = 1.2;
const SWITCH_TURN = (38 * Math.PI) / 180; // widest kink a tram takes from one edge onto the next
const STOP_SNAP = 6; // metres from a tram_stop node to its track
const SIGNAL_REACH = 9; // metres from a signalised junction's centre to a track that obeys it
const TRAM_DRIVER = { a: 1.15, b: 1.4, T: 1.6, s0: 3.0, aLat: 0.9, bMax: 3.0 };
const STREET_SPEED = 50 / 3.6; // street-running track
const TRACK_SPEED = 65 / 3.6; // segregated track
const LOOKAHEAD = 140; // metres a tram driver looks ahead for trams, stops, signals and switches
const CURVE_LOOKAHEAD = 80;
const CONFLICT_REACH = 60; // switches & crossings closer than this are checked for other trams
// Clearance points: converging tracks stay closer than a tram's width for several metres before a merge or crossing.
// Every edge measures how far from each end it stays within FOUL_GAP of the other tracks at that node (foulStart,
// foulEnd; at least FOUL_MIN); a tram waiting for another to clear a node stops that far before it, and a tram whose
// rear is still that close to a node it has passed holds the node. Crossings off the nodes use FOUL.
const FOUL = 9;
const FOUL_MIN = 4;
const FOUL_GAP = 2.9;
const DWELL_MIN = 20;
const DWELL_SPREAD = 10;
const TRAM_RADIUS = 900; // trams further than this from the camera are respawned near it
const SPAWN_MIN = 120;
const SPAWN_VIEW = 300; // no spawning in view this close
const SPAWN_SPACING = 70;
const TRAM_CULL = 1500;
const PATH_CAP = 32;
const TRAM_SPOT_POOL = 8; // 2 per lit tram
const TRAM_LIGHT_DIST = 110;
const OBSTACLE_REACH = 70; // furthest a tram looks for cars and the player on its track
const SWEEP_STEP = 2;
const SWEEP_N = Math.ceil(OBSTACLE_REACH / SWEEP_STEP) + 1;

// Articulated models (z = +front). Sections are listed front to rear; `cab` +1 has the driver's cab at +z (the front
// of the tram), -1 the rear end at -z. Door z centres are on the right (-x) side; 99 = no door. Lengths add up to the
// real ones: Moderus Gamma LF 03 AC 31.8 m in 3 sections, Solaris Tramino S105p 31.8 m in 5 (short suspended links
// between the bogie modules). The kind names one shared geometry.
const TRAM_MODELS = {
  gamma: {
    id: 'gamma',
    name: 'Moderus Gamma',
    livery: 0,
    gap: 0.3,
    sections: [
      { kind: 'gammaFront', len: 11.8, cab: 1, doors: [2.7, -3.4], bogies: [3.4, -3.8], pantograph: false },
      { kind: 'gammaMid', len: 7.6, cab: 0, doors: [0.4, 99], bogies: [-1.6], pantograph: true },
      { kind: 'gammaRear', len: 11.8, cab: -1, doors: [3.4, -2.7], bogies: [3.8, -3.4], pantograph: false }
    ]
  },
  tramino: {
    id: 'tramino',
    name: 'Solaris Tramino',
    livery: 1,
    gap: 0.25,
    sections: [
      { kind: 'traminoFront', len: 8.2, cab: 1, doors: [1.5, 99], bogies: [-1.9], pantograph: false },
      { kind: 'traminoLink', len: 4.3, cab: 0, doors: [0, 99], bogies: [], pantograph: false },
      { kind: 'traminoMid', len: 5.8, cab: 0, doors: [99, 99], bogies: [0], pantograph: true },
      { kind: 'traminoLink', len: 4.3, cab: 0, doors: [0, 99], bogies: [], pantograph: false },
      { kind: 'traminoRear', len: 8.2, cab: -1, doors: [-1.5, 99], bogies: [1.9], pantograph: false }
    ]
  }
};
for (const m of Object.values(TRAM_MODELS)) {
  m.length = m.sections.reduce((sum, s) => sum + s.len, 0) + m.gap * (m.sections.length - 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Track graph
// ---------------------------------------------------------------------------------------------------------------------
// Directed edges: { id, chain (index into GEO.rail), flip (true when it runs against the chain's pts), pts (flat x,z),
// cum (arc length at each vertex), len, street, from, to (nodes), next, prev (edges a tram may continue onto / come
// from), reverse (the same chain the other way, or null), run (single-track block id, -1 if one-way), runDir (+1/-1
// along the block), stx/stz & etx/etz (unit start & end tangents), vmax (curve speed limit at each vertex, m/s), stops,
// signals, box [x0, x1, z0, z1] }. Nodes: { id, x, z, in, out }.
//
// Most double track in OSM is two parallel ways without oneway tags, so a chain that is not one-way but runs alongside
// another tram track (RIGHT_HAND_GAP) is taken as one track of a pair and given the direction that keeps its neighbour
// on the left (right-hand running). Only the rest (single track, junction stubs) stays two-way.
const RIGHT_HAND_GAP = [1.8, 6.5];

// +1 if the chain is the right-hand track along its pts, -1 against them, 0 if no parallel neighbour decides it
function rightHandDirection(r, others) {
  const p = r.pts;
  let left = 0;
  let right = 0;
  let next = 6;
  let along = 0;
  let total = 0;
  for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1];
    const sx = p[i] - ax, sz = p[i + 1] - az;
    const l = Math.hypot(sx, sz);
    if (l === 0) continue;
    const tx = sx / l, tz = sz / l;
    while (next <= along + l && next < total - 6) {
      const x = ax + tx * (next - along);
      const z = az + tz * (next - along);
      next += 15;
      let best = RIGHT_HAND_GAP[1];
      let side = 0;
      for (const o of others) {
        if (o === r || x < o.box[0] - best || x > o.box[1] + best || z < o.box[2] - best || z > o.box[3] + best) continue;
        const q = o.pts;
        for (let j = 2; j < q.length; j += 2) {
          const bx = q[j - 2], bz = q[j - 1];
          const ux = q[j] - bx, uz = q[j + 1] - bz;
          const l2 = ux * ux + uz * uz;
          if (l2 === 0) continue;
          const lu = Math.sqrt(l2);
          if (Math.abs((ux * tx + uz * tz) / lu) < 0.9) continue; // not parallel
          const t = Math.max(0, Math.min(1, ((x - bx) * ux + (z - bz) * uz) / l2));
          const ox = bx + ux * t - x;
          const oz = bz + uz * t - z;
          const d = Math.hypot(ox, oz);
          if (d < best && d >= RIGHT_HAND_GAP[0]) {
            best = d;
            side = ox * tz - oz * tx; // > 0: on the left (+x is the left when facing +z)
          }
        }
      }
      if (side > 0) left++;
      else if (side < 0) right++;
    }
    along += l;
  }
  if (left + right < 2) return 0;
  if (left >= 3 * right) return 1;
  if (right >= 3 * left) return -1;
  return 0;
}

function buildTrackGraph(rail, maxTurn = SWITCH_TURN) {
  const nodes = [];
  const nodeAt = new Map();
  const node = (x, z) => {
    const key = `${x},${z}`;
    let n = nodeAt.get(key);
    if (!n) {
      n = { id: nodes.length, x, z, in: [], out: [] };
      nodeAt.set(key, n);
      nodes.push(n);
    }
    return n;
  };
  const edges = [];
  const addEdge = (flat, street, chain, flip) => {
    const xs = [];
    for (let i = 0; i < flat.length; i += 2) {
      const k = xs.length;
      if (k >= 2 && xs[k - 2] === flat[i] && xs[k - 1] === flat[i + 1]) continue;
      xs.push(flat[i], flat[i + 1]);
    }
    const n = xs.length / 2;
    if (n < 2) return null;
    const pts = Float64Array.from(xs);
    const cum = new Float64Array(n);
    const box = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
      box[0] = Math.min(box[0], pts[2 * i]);
      box[1] = Math.max(box[1], pts[2 * i]);
      box[2] = Math.min(box[2], pts[2 * i + 1]);
      box[3] = Math.max(box[3], pts[2 * i + 1]);
    }
    const len = cum[n - 1];
    if (len < 0.5) return null;
    const s0 = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]);
    const s1 = len - cum[n - 2];
    const e = {
      id: edges.length, chain, flip, pts, cum, len, street: !!street, run: -1, runDir: 0,
      from: node(pts[0], pts[1]), to: node(pts[2 * n - 2], pts[2 * n - 1]),
      next: [], prev: [], reverse: null,
      stx: (pts[2] - pts[0]) / s0, stz: (pts[3] - pts[1]) / s0,
      etx: (pts[2 * n - 2] - pts[2 * n - 4]) / s1, etz: (pts[2 * n - 1] - pts[2 * n - 3]) / s1,
      vmax: new Float32Array(n).fill(Infinity), stops: [], signals: [], crossings: [], endPad: 1,
      foulStart: FOUL_MIN, foulEnd: FOUL_MIN, box
    };
    e.from.out.push(e);
    e.to.in.push(e);
    edges.push(e);
    return e;
  };
  const chains = [];
  rail.forEach((r, chain) => {
    if (r.kind !== 'tram' || !r.pts || r.pts.length < 4) return;
    const box = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < r.pts.length; i += 2) {
      box[0] = Math.min(box[0], r.pts[i]);
      box[1] = Math.max(box[1], r.pts[i]);
      box[2] = Math.min(box[2], r.pts[i + 1]);
      box[3] = Math.max(box[3], r.pts[i + 1]);
    }
    chains.push({ r, chain, pts: r.pts, box });
  });
  for (const c of chains) {
    const { r, chain } = c;
    const dir = r.oneway ? 1 : rightHandDirection(c, chains);
    const back = [];
    if (dir <= 0) for (let i = r.pts.length - 2; i >= 0; i -= 2) back.push(r.pts[i], r.pts[i + 1]);
    const fwd = dir >= 0 ? addEdge(r.pts, r.street, chain, false) : null;
    const rev = dir <= 0 ? addEdge(back, r.street, chain, true) : null;
    if (fwd && rev) {
      fwd.reverse = rev;
      rev.reverse = fwd;
    }
  }

  // Switches: continue only onto edges that leave within maxTurn of the arriving direction (never back the same way)
  const minCos = Math.cos(maxTurn);
  for (const e of edges) {
    for (const f of e.to.out) {
      if (f === e.reverse) continue;
      if (e.etx * f.stx + e.etz * f.stz >= minCos) {
        e.next.push(f);
        f.prev.push(e);
      }
    }
  }

  // Curve speed limits: curvature at each vertex from the turn angle over the neighbouring segments, including the
  // kink onto the edge from its sharpest predecessor at the first vertex
  const { aLat } = TRAM_DRIVER;
  const limit = (angle, span) => (angle < 1e-4 ? Infinity : Math.sqrt((aLat * span) / angle));
  for (const e of edges) {
    const p = e.pts;
    for (let i = 1; i < e.cum.length - 1; i++) {
      const ax = p[2 * i] - p[2 * i - 2], az = p[2 * i + 1] - p[2 * i - 1];
      const bx = p[2 * i + 2] - p[2 * i], bz = p[2 * i + 3] - p[2 * i + 1];
      const angle = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      e.vmax[i] = limit(angle, 0.5 * (e.cum[i + 1] - e.cum[i - 1]));
    }
    for (const g of e.prev) {
      const angle = Math.abs(Math.atan2(g.etx * e.stz - g.etz * e.stx, g.etx * e.stx + g.etz * e.stz));
      const span = 0.5 * (e.cum[1] + g.len - g.cum[g.cum.length - 2]);
      e.vmax[0] = Math.min(e.vmax[0], limit(angle, span));
    }
  }

  // Level crossings the chains don't meet at (diamonds the data leaves uncut, depot tracks across the line):
  // e.crossings [{ s, other, os }] with s along e and os along `other` (one direction of the crossing chain; its
  // reverse, if any, is the same track). Intersections within 1 m of either chain's ends are junctions, not crossings.
  const base = edges.filter((e) => !e.flip || !e.reverse);
  for (let a = 0; a < base.length; a++) {
    const A = base[a];
    for (let b = a + 1; b < base.length; b++) {
      const B = base[b];
      if (A.chain === B.chain || A.box[0] > B.box[1] || B.box[0] > A.box[1] || A.box[2] > B.box[3] || B.box[2] > A.box[3]) continue;
      const P = A.pts;
      const Q = B.pts;
      for (let i = 0; i + 1 < A.cum.length; i++) {
        const ax = P[2 * i], az = P[2 * i + 1], ux = P[2 * i + 2] - ax, uz = P[2 * i + 3] - az;
        for (let j = 0; j + 1 < B.cum.length; j++) {
          const bx = Q[2 * j], bz = Q[2 * j + 1], vx = Q[2 * j + 2] - bx, vz = Q[2 * j + 3] - bz;
          const den = ux * vz - uz * vx;
          if (Math.abs(den) < 1e-9) continue;
          const ta = ((bx - ax) * vz - (bz - az) * vx) / den;
          const tb = ((bx - ax) * uz - (bz - az) * ux) / den;
          if (ta < 0 || ta > 1 || tb < 0 || tb > 1) continue;
          const sa = A.cum[i] + ta * (A.cum[i + 1] - A.cum[i]);
          const sb = B.cum[j] + tb * (B.cum[j + 1] - B.cum[j]);
          const ix = ax + ux * ta;
          const iz = az + uz * ta;
          const shared = (n) => (n === B.from || n === B.to) && Math.hypot(n.x - ix, n.z - iz) < 1.5;
          if (shared(A.from) || shared(A.to)) continue;
          A.crossings.push({ s: sa, other: B, os: sb });
          B.crossings.push({ s: sb, other: A, os: sa });
          if (A.reverse) A.reverse.crossings.push({ s: A.len - sa, other: B, os: sb });
          if (B.reverse) B.reverse.crossings.push({ s: B.len - sb, other: A, os: sa });
        }
      }
    }
  }

  // Clearance points at both ends of every edge (see FOUL)
  const near = { d: 0, s: 0, tx: 0, tz: 0 };
  const at = { x: 0, z: 0, tx: 0, tz: 0 };
  const clearFrom = (e, N, fromEnd) => {
    const others = [];
    for (const g of N.in.concat(N.out)) if (g !== e && g !== e.reverse && g.chain !== e.chain) others.push(g);
    if (!others.length) return FOUL_MIN;
    for (let d = 1; d <= Math.min(60, e.len); d += 1) {
      edgePoint(e, fromEnd ? e.len - d : d, at);
      let min = Infinity;
      for (const g of others) min = Math.min(min, nearestOnEdge(g, at.x, at.z, near).d);
      if (min >= FOUL_GAP) return Math.max(FOUL_MIN, d + 1);
    }
    return Math.max(FOUL_MIN, Math.min(60, e.len) + 1);
  };
  for (const e of edges) {
    e.foulStart = clearFrom(e, e.from, false);
    e.foulEnd = clearFrom(e, e.to, true);
  }

  // Buffer stops: a dead end that runs out next to another track (stubs ending on the line) stops trams short of it
  for (const e of edges) {
    if (e.next.length) continue;
    const x = e.pts[e.pts.length - 2];
    const z = e.pts[e.pts.length - 1];
    for (const f of edges) {
      if (f.chain === e.chain || !nearBox(f, x, z, 4)) continue;
      if (nearestOnEdge(f, x, z, near).d < 4) e.endPad = 1 + 2 * FOUL;
    }
  }

  // Single-track blocks: two-way edges joined end to start, both directions sharing one run id; runDir tells the
  // two directions apart (a tram may enter a block only while nobody in it, or entering it first, runs the other way)
  let runs = 0;
  for (const seed of edges) {
    if (!seed.reverse || seed.run >= 0) continue;
    const id = runs++;
    const queue = [seed];
    seed.run = id;
    seed.runDir = 1;
    while (queue.length) {
      const e = queue.pop();
      const link = (f, dir) => {
        if (f && f.reverse && f.run < 0) {
          f.run = id;
          f.runDir = dir;
          queue.push(f);
        }
      };
      link(e.reverse, -e.runDir);
      for (const f of e.next) link(f, e.runDir);
      for (const f of e.prev) link(f, e.runDir);
    }
  }
  return { nodes, edges, runs };
}

// Point at arc length s along an edge (extrapolated straight past either end): out.x, out.z and the unit tangent
// out.tx, out.tz
function edgePoint(e, s, out) {
  const p = e.pts;
  const cum = e.cum;
  const last = cum.length - 1;
  if (s <= 0) {
    out.tx = e.stx;
    out.tz = e.stz;
    out.x = p[0] + e.stx * s;
    out.z = p[1] + e.stz * s;
    return out;
  }
  if (s >= e.len) {
    out.tx = e.etx;
    out.tz = e.etz;
    out.x = p[2 * last] + e.etx * (s - e.len);
    out.z = p[2 * last + 1] + e.etz * (s - e.len);
    return out;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = (s - cum[lo]) / seg;
  const dx = p[2 * hi] - p[2 * lo];
  const dz = p[2 * hi + 1] - p[2 * lo + 1];
  out.x = p[2 * lo] + dx * t;
  out.z = p[2 * lo + 1] + dz * t;
  out.tx = dx / seg;
  out.tz = dz / seg;
  return out;
}

// Nearest point of an edge to (x, z): sets out.d (distance), out.s (arc length), out.tx/out.tz (tangent there)
function nearestOnEdge(e, x, z, out) {
  const p = e.pts;
  out.d = Infinity;
  for (let i = 0; i + 1 < e.cum.length; i++) {
    const ax = p[2 * i], az = p[2 * i + 1];
    const sx = p[2 * i + 2] - ax, sz = p[2 * i + 3] - az;
    const l2 = sx * sx + sz * sz;
    const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / l2));
    const d = Math.hypot(ax + sx * t - x, az + sz * t - z);
    if (d < out.d) {
      const l = Math.sqrt(l2);
      out.d = d;
      out.s = e.cum[i] + t * l;
      out.tx = sx / l;
      out.tz = sz / l;
    }
  }
  return out;
}

const nearBox = (e, x, z, r) => x > e.box[0] - r && x < e.box[1] + r && z > e.box[2] - r && z < e.box[3] + r;

// Stops: each GEO.tramStops node goes on the nearest track within maxDist, on both directions of a two-way track
// (and on any other track as close, within 0.3 m). Returns [{ name, x, z, at: [{ edge, s }] }]; each edge lists its
// own as edge.stops [{ stop, s }] sorted by s.
function snapTramStops(graph, stops, maxDist = STOP_SNAP) {
  const near = { d: 0, s: 0, tx: 0, tz: 0 };
  const out = [];
  for (const st of stops) {
    const hits = [];
    let best = maxDist;
    for (const e of graph.edges) {
      if (!nearBox(e, st.x, st.z, maxDist)) continue;
      nearestOnEdge(e, st.x, st.z, near);
      if (near.d <= maxDist) hits.push([e, near.d, near.s]);
      if (near.d < best) best = near.d;
    }
    const stop = { name: st.name, x: st.x, z: st.z, at: [] };
    for (const [edge, d, s] of hits) {
      if (d > best + 0.3) continue;
      stop.at.push({ edge, s });
      edge.stops.push({ stop, s });
    }
    if (stop.at.length) out.push(stop);
  }
  for (const e of graph.edges) e.stops.sort((a, b) => a.s - b.s);
  return out;
}

// Stops laid out by tram-infra.js (the platforms): { name, x, z, railIndex, s, dir, ... } with s the arc length along
// GEO.rail[railIndex].pts and dir +1 when trams run along pts. Each goes on the edge of that chain running that way
// (edge.stops [{ stop, s }]); stops whose direction the graph doesn't run are dropped. Returns the stops placed, as
// [{ name, x, z, at: [{ edge, s }], source }].
function attachTramStops(graph, stops) {
  const out = [];
  for (const st of stops) {
    const flip = st.dir < 0;
    const edge = graph.edges.find((e) => e.chain === st.railIndex && e.flip === flip);
    if (!edge) continue;
    const s = Math.max(0, Math.min(edge.len, flip ? edge.len - st.s : st.s));
    const stop = { name: st.name, x: st.x, z: st.z, at: [{ edge, s }], source: st };
    edge.stops.push({ stop, s });
    out.push(stop);
  }
  for (const e of graph.edges) e.stops.sort((a, b) => a.s - b.s);
  return out;
}

// Signals: every signalised road junction (road-network.js nodes with n.signal) within `reach` of a tram edge holds
// that edge's trams at a stop line before it. The stop line is as far from the junction centre as the stop line of the
// road arm the tram arrives along (its in-edge's end); the tram runs with that arm's group (0 = the widest road, as
// the cars' phaseOf). A track crossing the junction along none of its roads runs with the group the roads don't use.
// Returns [{ node, edge, s, group }]; each edge lists its own as edge.signals sorted by s (s may be negative: the line
// is then on the edge before).
function findTrackSignals(graph, roadNodes, reach = SIGNAL_REACH) {
  const near = { d: 0, s: 0, tx: 0, tz: 0 };
  const at = { x: 0, z: 0, tx: 0, tz: 0 };
  const out = [];
  for (const n of roadNodes) {
    if (!n.signal) continue;
    for (const e of graph.edges) {
      if (!nearBox(e, n.x, n.z, reach)) continue;
      nearestOnEdge(e, n.x, n.z, near);
      if (near.d > reach) continue;
      // The approach direction: the track tangent ~12 m before the junction
      edgePoint(e, near.s - 12, at);
      let best = null;
      let bestCos = 0.5;
      let group0 = false;
      for (const r of n.in || []) {
        if (r.axisIndex === 0) group0 = true;
        const c = r.dx * at.tx + r.dz * at.tz;
        if (c > bestCos) {
          bestCos = c;
          best = r;
        }
      }
      let line = 6;
      let group = group0 ? 1 : 0;
      if (best) {
        group = best.axisIndex === 0 ? 0 : 1;
        line = Math.hypot(best.sx + best.dx * best.len - n.x, best.sz + best.dz * best.len - n.z);
      }
      const s = near.s - Math.max(4, Math.min(18, line));
      const sig = { node: n, edge: e, s, group };
      e.signals.push(sig);
      out.push(sig);
    }
  }
  for (const e of graph.edges) e.signals.sort((a, b) => a.s - b.s);
  return out;
}

// Where the trams share the road with the cars (docs/actors.md "Trams"), worked out once from the geometry: street
// track mostly runs in the widened carriageway, and the geodata carries no link between a track and its road.
// - edge.lanes [{ edge, lane, s0, s1, l0, l1, dir, pad }]: the stretches [s0, s1] of this tram edge where car lane
//   `lane` of road edge `edge` runs within `gap` of the track (car and tram bodies overlap);
//   l0/l1 are the lane positions at s0/s1 (linear in between), dir +1 where the lane runs the tram's way, -1 against
//   it, 0 where it crosses the track; pad is how far the tram's width reaches along the lane.
// - edge.junctions [{ node, e, i, f, j, s0, s1, held, by }]: the lane-to-lane curves through road junctions (lane i of
//   e into lane j of f) that pass over [s0, s1] of this tram edge; the same objects are listed on the road node as
//   node.tramConflicts. traffic.js marks them `held` (a frame number) by the tram `by` while a tram is over them or
//   about to be, and cars don't take a held curve.
// `gap` 2.3 m: the tram's half width 1.2 m plus a car's 0.92 m, plus a little. Measured 2026-10 on the Poznań data:
// 9.4 of the 72.5 km of directed track run over car lanes (7.9 km the lanes' way, 0.75 km against, 1.1 km across).
const ROAD_OVERLAP = 2.3;
function mapTramsToRoads(graph, network, gap = ROAD_OVERLAP) {
  const roads = (network && network.edges) || [];
  const CELL = 40;
  const cellKey = (i, j) => (i + 32768) * 65536 + (j + 32768);
  const cellOf = (x, z) => cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
  const addToGrid = (grid, item, x0, x1, z0, z1) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = cellKey(i, j);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(item);
      }
    }
  };
  const roadGrid = new Map();
  for (const r of roads) {
    if (!r.lanes || !r.lanes.length) continue;
    let reach = gap;
    for (const l of r.lanes) reach = Math.max(reach, Math.abs(l) + gap);
    const ex = r.sx + r.dx * r.len;
    const ez = r.sz + r.dz * r.len;
    addToGrid(roadGrid, r, Math.min(r.sx, ex) - reach, Math.max(r.sx, ex) + reach, Math.min(r.sz, ez) - reach, Math.max(r.sz, ez) + reach);
  }
  const at = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const te of graph.edges) {
    te.lanes = [];
    te.junctions = [];
    const open = new Map();
    for (let s = 0; s <= te.len + 0.5; s += 1) {
      const ss = Math.min(s, te.len);
      edgePoint(te, ss, at);
      const cell = roadGrid.get(cellOf(at.x, at.z));
      if (!cell) continue;
      for (const r of cell) {
        const px = at.x - r.sx;
        const pz = at.z - r.sz;
        const along = px * r.dx + pz * r.dz;
        if (along < 0 || along > r.len) continue;
        const lat = px * r.rx + pz * r.rz;
        const cos = at.tx * r.dx + at.tz * r.dz;
        for (let i = 0; i < r.lanes.length; i++) {
          if (Math.abs(lat - r.lanes[i]) >= gap) continue;
          const key = r.id * 16 + i;
          let run = open.get(key);
          if (!run || ss - run.s1 > 1.5) {
            run = { edge: r, lane: i, s0: ss, s1: ss, l0: along, l1: along, dir: 0, pad: 0, cos: 0, n: 0 };
            open.set(key, run);
            te.lanes.push(run);
          }
          run.s1 = ss;
          run.l1 = along;
          run.cos += cos;
          run.n++;
        }
      }
    }
    for (const run of te.lanes) {
      const cos = run.cos / run.n;
      run.dir = cos > 0.5 ? 1 : cos < -0.5 ? -1 : 0;
      run.pad = TRAM_HALF_WIDTH * Math.sqrt(Math.max(0, 1 - cos * cos)) + 0.5;
      run.s0 = Math.max(0, run.s0 - 0.5);
      run.s1 = Math.min(te.len, run.s1 + 0.5);
    }
  }

  // Junction curves over the track: the road nodes near a track, every lane-to-lane curve through them sampled each
  // metre against the tram edges close by
  if (!network || !network.nodes || !network.connector || !network.curvePoint) return;
  // track segments by cell: [edge, first vertex index] pairs
  const tramGrid = new Map();
  for (const te of graph.edges) {
    const p = te.pts;
    for (let k = 0; k + 1 < te.cum.length; k++) {
      addToGrid(tramGrid, [te, k], Math.min(p[2 * k], p[2 * k + 2]) - gap, Math.max(p[2 * k], p[2 * k + 2]) + gap,
        Math.min(p[2 * k + 1], p[2 * k + 3]) - gap, Math.max(p[2 * k + 1], p[2 * k + 3]) + gap);
    }
  }
  const pt = { x: 0, z: 0, dx: 0, dz: 1 };
  const hits = new Map();
  for (const n of network.nodes) {
    if (!n.in || !n.in.length) continue;
    let close = false;
    for (let i = -1; i <= 1 && !close; i++) {
      for (let j = -1; j <= 1 && !close; j++) close = tramGrid.has(cellOf(n.x + i * CELL, n.z + j * CELL));
    }
    if (!close) continue;
    for (const e of n.in) {
      for (const m of e.moves || []) {
        const f = m.to;
        for (let i = 0; i < m.out.length; i++) {
          const j = m.out[i];
          if (j < 0) continue;
          const c = network.connector(e, i, f, j);
          hits.clear();
          for (let cs = 0; cs <= c.len + 0.5; cs += 1) {
            network.curvePoint(c, Math.min(cs, c.len), pt);
            const cell = tramGrid.get(cellOf(pt.x, pt.z));
            if (!cell) continue;
            for (const [te, k] of cell) {
              const p = te.pts;
              const ax = p[2 * k], az = p[2 * k + 1];
              const sx = p[2 * k + 2] - ax, sz = p[2 * k + 3] - az;
              const l2 = sx * sx + sz * sz;
              const u = Math.max(0, Math.min(1, ((pt.x - ax) * sx + (pt.z - az) * sz) / l2));
              if (Math.hypot(ax + sx * u - pt.x, az + sz * u - pt.z) >= gap - 0.1) continue; // a car on its lane line
              const ts = te.cum[k] + u * (te.cum[k + 1] - te.cum[k]);
              const h = hits.get(te);
              if (h) {
                h[0] = Math.min(h[0], ts);
                h[1] = Math.max(h[1], ts);
              } else hits.set(te, [ts, ts]);
            }
          }
          for (const [te, [s0, s1]] of hits) {
            const conflict = { node: n, e, i, f, j, s0: Math.max(0, s0 - 1.5), s1: Math.min(te.len, s1 + 1.5), held: -1, by: null };
            te.junctions.push(conflict);
            (n.tramConflicts || (n.tramConflicts = [])).push(conflict);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// A tram's path: the edges under and ahead of it, in one arc-length coordinate (u) that starts at the first edge.
// The branch at every switch is chosen once, when the path is extended, so every check this frame and the next sees
// the same route. Fixed capacity; reset/trim/extend allocate nothing.
// ---------------------------------------------------------------------------------------------------------------------
const _back = [];

class TramPath {
  constructor() {
    this.edges = new Array(PATH_CAP).fill(null);
    this.start = new Float64Array(PATH_CAP);
    this.n = 0;
    this.u = 0; // the tram's front
    this.end = Infinity; // path coordinate of a dead end once the path has reached one
  }

  // Front at s on edge, with at least `back` metres of track behind it where predecessors exist
  reset(edge, s, back, rand) {
    let k = 0;
    _back[k++] = edge;
    let covered = s;
    while (covered < back && k < PATH_CAP >> 1) {
      const prev = _back[k - 1].prev;
      if (!prev.length) break;
      const p = prev[Math.floor(rand() * prev.length) % prev.length];
      _back[k++] = p;
      covered += p.len;
    }
    let acc = 0;
    this.n = 0;
    for (let i = k - 1; i >= 0; i--) {
      this.edges[this.n] = _back[i];
      this.start[this.n] = acc;
      acc += _back[i].len;
      this.n++;
      _back[i] = null;
    }
    for (let i = this.n; i < PATH_CAP; i++) this.edges[i] = null;
    this.u = this.start[this.n - 1] + s;
    this.end = Infinity;
  }

  // Choose branches until the path reaches `ahead` metres past the front (or a dead end)
  extend(ahead, rand) {
    while (this.n < PATH_CAP && this.end === Infinity) {
      const last = this.edges[this.n - 1];
      const lastEnd = this.start[this.n - 1] + last.len;
      if (lastEnd - this.u >= ahead) break;
      if (!last.next.length) {
        this.end = lastEnd;
        break;
      }
      this.edges[this.n] = last.next[Math.floor(rand() * last.next.length) % last.next.length];
      this.start[this.n] = lastEnd;
      this.n++;
    }
  }

  // Drop the edges that end more than `behind` metres behind the front
  trim(behind) {
    while (this.n > 1 && this.start[1] < this.u - behind) {
      const d = this.start[1];
      for (let i = 0; i + 1 < this.n; i++) {
        this.edges[i] = this.edges[i + 1];
        this.start[i] = this.start[i + 1] - d;
      }
      this.n--;
      this.edges[this.n] = null;
      this.u -= d;
      this.end -= d;
    }
  }

  // Index of the edge under path coordinate u
  indexAt(u) {
    let i = 0;
    while (i + 1 < this.n && this.start[i + 1] <= u) i++;
    return i;
  }

  pointAt(u, out) {
    const i = this.indexAt(u);
    return edgePoint(this.edges[i], u - this.start[i], out);
  }
}

// Section poses for a tram whose front is at path coordinate u: each section on the chord between its front and rear
// end on the track (where the articulation joints and the end bogies run), so on curves the sections bend round and
// stay joined at the track. Fills out[k] = { x, z, heading, halfLength, halfWidth, fx, fz, rx, rz } (front/rear ends).
const _pf = { x: 0, z: 0, tx: 0, tz: 1 };
const _pr = { x: 0, z: 0, tx: 0, tz: 1 };
function poseSections(path, u, model, out) {
  let uf = u;
  const secs = model.sections;
  for (let k = 0; k < secs.length; k++) {
    const len = secs[k].len;
    path.pointAt(uf, _pf);
    path.pointAt(uf - len, _pr);
    const o = out[k];
    const dx = _pf.x - _pr.x;
    const dz = _pf.z - _pr.z;
    const d = Math.hypot(dx, dz) || 1;
    o.heading = Math.atan2(dx, dz);
    o.x = (_pf.x + _pr.x) * 0.5;
    o.z = (_pf.z + _pr.z) * 0.5;
    o.halfLength = len * 0.5;
    o.halfWidth = TRAM_HALF_WIDTH;
    // The rigid body's ends, along the chord
    o.fx = o.x + (dx / d) * o.halfLength;
    o.fz = o.z + (dz / d) * o.halfLength;
    o.rx = o.x - (dx / d) * o.halfLength;
    o.rz = o.z - (dz / d) * o.halfLength;
    uf -= len + model.gap;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The tram system
// ---------------------------------------------------------------------------------------------------------------------
function createTramSystem(scene, { network = null, rail = GEO.rail, stops = GEO.tramStops, traffic = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Trams';
  scene.add(group);

  const graph = buildTrackGraph(rail || []);
  mapTramsToRoads(graph, network);
  // tram-infra.js stops (with railIndex) sit at the platforms; bare GEO.tramStops nodes are snapped to the track
  const tramStops = stops && stops.length && stops[0].railIndex !== undefined
    ? attachTramStops(graph, stops)
    : snapTramStops(graph, stops || []);
  const signals = findTrackSignals(graph, network ? network.nodes : []);

  let seed = 1922; // the first electric tram in Poznań (1898 horse tram, 1922 MPK)
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // The pool: a third Tramino (45 of 127 in service), the rest Gamma
  const pool = [];
  for (let i = 0; i < NUM_TRAMS; i++) {
    const model = i % 3 === 2 ? TRAM_MODELS.tramino : TRAM_MODELS.gamma;
    pool.push({
      id: i, model: model.id, spec: model, length: model.length,
      active: false, path: new TramPath(),
      x: 0, z: 0, heading: 0, speed: 0, acc: 0, v0: 0, v0Factor: 0.9 + rand() * 0.1,
      frontX: 0, frontZ: 0,
      sections: model.sections.map(() => ({ x: 0, z: 0, heading: 0, halfLength: 0, halfWidth: TRAM_HALF_WIDTH, fx: 0, fz: 0, rx: 0, rz: 0 })),
      atStop: false, stopName: '', dwell: 0, doorsOpen: false, nextStop: null, lastStop: null,
      leader: null, gap: Infinity, waitReason: '', obstacle: null,
      deadEndWait: 0, stuck: 0,
      // per-frame occupancy: the path edges under the body, local [s0, s1] on each
      occN: 0, occEdge: new Array(PATH_CAP).fill(null), occS0: new Float64Array(PATH_CAP), occS1: new Float64Array(PATH_CAP),
      _frontMatrix: new THREE.Matrix4(), _effDist: 0, _visible: false
    });
  }
  const trams = [];

  // Meshes: one per section kind (+ the bellows), capacity = the kind's count over the pool
  const material = createTramMaterial();
  const kindCount = new Map();
  const kindSpec = new Map();
  for (const t of pool) {
    for (const s of t.spec.sections) {
      kindCount.set(s.kind, (kindCount.get(s.kind) || 0) + 1);
      if (!kindSpec.has(s.kind)) kindSpec.set(s.kind, [s, t.spec]);
    }
  }
  const meshes = new Map();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const makeMesh = (geo, n, name, livery) => {
    const state = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) state[i * 4 + 1] = livery;
    geo.setAttribute('tramState', new THREE.InstancedBufferAttribute(state, 4));
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
    mesh.count = 1; // one zero-scale instance until the first updates (shader precompile & warm-up frame)
    group.add(mesh);
    return mesh;
  };
  for (const [kind, n] of kindCount) {
    const [section, model] = kindSpec.get(kind);
    meshes.set(kind, makeMesh(buildTramSectionGeometry(section), n, `Tram_${kind}`, model.livery));
  }
  let joints = 0;
  for (const t of pool) joints += t.spec.sections.length - 1;
  const bellows = makeMesh(buildTramBellowsGeometry(), joints, 'Tram_bellows', 0);
  const allMeshes = [...meshes.values(), bellows];

  // Headlight pool (clustered lighting: created now, parked when unused)
  const lightSpecs = {};
  for (const m of Object.values(TRAM_MODELS)) lightSpecs[m.id] = tramLightSpec(m.sections[0].len);
  const spots = [];
  for (let i = 0; i < TRAM_SPOT_POOL; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    group.add(spot, spot.target);
    spots.push(spot);
  }
  const lit = [];
  const byEffDist = (a, b) => a._effDist - b._effDist;

  // Camera view (side planes only, as traffic.js)
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  let hasView = false;
  let camX = 0, camY = 0, camZ = 0, camFwdX = 0, camFwdZ = 1;
  function visible(x, z, r) {
    if (!hasView) return false;
    for (let k = 0; k < 4; k++) {
      const { normal, constant } = frustum.planes[k];
      if (normal.x * x + normal.y + normal.z * z + constant < -r) return false;
    }
    return true;
  }
  const nearView = (x, z, r, distance) => hasView && Math.hypot(x - camX, camY, z - camZ) < distance && visible(x, z, r);

  // Edges around the focus, to spawn on (refreshed after the focus moves 60 m)
  const nearEdges = [];
  let nearX = Infinity;
  let nearZ = Infinity;
  function refreshNear(fx, fz) {
    if (Math.hypot(fx - nearX, fz - nearZ) < 60) return;
    nearX = fx;
    nearZ = fz;
    nearEdges.length = 0;
    for (const e of graph.edges) if (nearBox(e, fx, fz, TRAM_RADIUS - 100)) nearEdges.push(e);
  }

  const _p = { x: 0, z: 0, tx: 0, tz: 1 };
  function placeMid(t) {
    t.path.pointAt(t.path.u - t.length * 0.5, _p);
    t.x = _p.x;
    t.z = _p.z;
    t.heading = Math.atan2(_p.tx, _p.tz);
  }

  // Try to put tram t on the track near the focus: false if this attempt found no free spot
  function spawn(t, fx, fz, minD, protectView) {
    if (!nearEdges.length) return false;
    const e = nearEdges[Math.floor(rand() * nearEdges.length) % nearEdges.length];
    const s = rand() * e.len;
    edgePoint(e, s, _p);
    const d = Math.hypot(_p.x - fx, _p.z - fz);
    if (d < minD || d > TRAM_RADIUS - 100) return false;
    if (protectView && nearView(_p.x, _p.z, 25, SPAWN_VIEW)) return false;
    for (const o of pool) {
      if (o === t || !o.active) continue;
      if (Math.hypot(o.x - _p.x, o.z - _p.z) < SPAWN_SPACING) return false;
    }
    const path = t.path;
    path.reset(e, s, t.length + 10, rand);
    path.extend(LOOKAHEAD, rand);
    if (path.end - path.u < 80) return false; // not just before a buffer stop
    for (let i = 0; i < path.n; i++) {
      const e = path.edges[i];
      if (e.run < 0) continue;
      for (const o of pool) if (o !== t && o.active && inRun(o, e.run, -e.runDir)) return false;
    }
    if (traffic && !trackClear(path, t.length)) return false;
    t.active = true;
    t.speed = Math.min(8, path.edges[path.indexAt(path.u)].street ? STREET_SPEED : TRACK_SPEED) * (0.4 + 0.6 * rand());
    t.acc = 0;
    t.atStop = false;
    t.doorsOpen = false;
    t.stopName = '';
    t.dwell = 0;
    t.nextStop = null;
    t.lastStop = null;
    t.deadEndWait = 0;
    t.stuck = 0;
    placeMid(t);
    return true;
  }

  // No car on the track from the rear of a tram placed with its front at path.u to 10 m ahead of it
  function trackClear(path, length) {
    for (let d = -length; d <= 10; d += 3) {
      path.pointAt(path.u + d, _p);
      for (let pass = 0; pass < 2; pass++) {
        const list = pass ? traffic.buses : traffic.cars;
        if (!list) continue;
        for (const v of list) {
          if (v.edge && Math.abs(v.x - _p.x) < v.half + 3 && Math.abs(v.z - _p.z) < v.half + 3 && Math.hypot(v.x - _p.x, v.z - _p.z) < v.half + 2.5) return false;
        }
      }
    }
    return true;
  }

  // Occupancy: the path edges under each tram's body, for the trams behind it
  function occupy(t) {
    const path = t.path;
    const rear = path.u - t.length;
    t.occN = 0;
    for (let i = 0; i < path.n; i++) {
      const s0 = path.start[i];
      const e = path.edges[i];
      if (s0 > path.u) break;
      if (s0 + e.len < rear) continue;
      const k = t.occN++;
      t.occEdge[k] = e;
      t.occS0[k] = Math.max(0, rear - s0);
      t.occS1[k] = Math.min(e.len, path.u - s0);
    }
    for (let k = t.occN; k < PATH_CAP && t.occEdge[k]; k++) t.occEdge[k] = null;
  }

  // IDM acceleration behind a leader `gap` metres ahead moving at vLead
  const D = TRAM_DRIVER;
  const brakeTerm = 2 * Math.sqrt(D.a * D.b);
  let _v = 0;
  let _v0 = 1;
  const idm = (gap, vLead) => {
    const sStar = D.s0 + Math.max(0, _v * D.T + (_v * (_v - vLead)) / brakeTerm);
    return D.a * (1 - (_v / _v0) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2);
  };
  // A stopped obstacle the front should come to rest `dist` metres ahead at
  const wall = (dist) => idm(dist + D.s0, 0);
  // The binding constraint so far in drive(): the lowest acceleration and what imposes it
  let _acc = 0;
  let _reason = '';
  function consider(a, why) {
    if (a < _acc) {
      _acc = a;
      _reason = why;
    }
  }

  // Does tram o's path reach node N ahead of its front (as the start of one of its edges), and how far ahead?
  // Returns the distance, or -1. _arrive holds the edge it arrives on.
  let _arrive = null;
  function reaches(o, N, maxD) {
    const path = o.path;
    for (let i = 1; i < path.n; i++) {
      const d = path.start[i] - path.u;
      if (d > maxD) break;
      if (d > 0 && path.edges[i].from === N) {
        _arrive = path.edges[i - 1];
        return d;
      }
    }
    return -1;
  }
  // Does tram o's body straddle node N (one of its edges starts under it)?
  // (straddling it, or its rear not yet past the clearance point beyond it)
  function holds(o, N) {
    for (let k = 1; k < o.occN; k++) if (o.occEdge[k].from === N) return true;
    return o.occN > 0 && o.occEdge[0].from === N && o.occS0[0] < o.occEdge[0].foulStart;
  }
  // Is tram o's body in single-track block `run`, running `dir` along it?
  function inRun(o, run, dir) {
    for (let k = 0; k < o.occN; k++) if (o.occEdge[k].run === run && o.occEdge[k].runDir === dir) return true;
    return false;
  }
  // Will tram o enter block `run` running `dir` within maxD (or as close, with a lower id than `id`)?
  function entersRun(o, run, dir, maxD, id) {
    const path = o.path;
    for (let i = 1; i < path.n; i++) {
      const d = path.start[i] - path.u;
      if (d > maxD) break;
      const e = path.edges[i];
      if (d > 0 && e.run === run && e.runDir === dir && path.edges[i - 1].run !== run) return d < maxD || o.id < id;
    }
    return false;
  }
  // Is tram o's body over point os of track B (either direction)?
  function crossHeld(o, B, os) {
    for (let k = 0; k < o.occN; k++) {
      const e = o.occEdge[k];
      const p = e === B ? os : e === B.reverse ? B.len - os : -1;
      if (p >= 0 && p >= o.occS0[k] - 2 && p <= o.occS1[k] + 2) return true;
    }
    return false;
  }
  // Will tram o's front reach point os of track B sooner than maxD (as soon, with a lower id than `id`)?
  function crossApproach(o, B, os, maxD, id) {
    const path = o.path;
    for (let i = path.indexAt(path.u); i < path.n; i++) {
      if (path.start[i] - path.u > maxD) break;
      const e = path.edges[i];
      const p = e === B ? os : e === B.reverse ? B.len - os : -1;
      if (p < 0) continue;
      const d = path.start[i] + p - path.u;
      if (d > 0 && (d < maxD || (d === maxD && o.id < id))) return true;
    }
    return false;
  }
  function occupies(o, e) {
    for (let k = 0; k < o.occN; k++) if (o.occEdge[k] === e) return true;
    return false;
  }

  // The swept path ahead of a tram's front: track points every SWEEP_STEP m up to its braking distance plus a margin,
  // with their bounding box, to find cars and the player in the way (one tram at a time, so one shared scratch)
  const sweepX = new Float64Array(SWEEP_N);
  const sweepZ = new Float64Array(SWEEP_N);
  const sweepTX = new Float64Array(SWEEP_N);
  const sweepTZ = new Float64Array(SWEEP_N);
  let sweepN = 0;
  let sx0 = 0, sx1 = 0, sz0 = 0, sz1 = 0;
  function sweep(t) {
    const path = t.path;
    const reach = Math.min(OBSTACLE_REACH, 12 + t.speed * D.T + (t.speed * t.speed) / (2 * D.b));
    sweepN = 0;
    sx0 = sz0 = Infinity;
    sx1 = sz1 = -Infinity;
    for (let d = 0; d <= reach && sweepN < SWEEP_N && path.u + d <= path.end; d += SWEEP_STEP) {
      path.pointAt(path.u + d, _p);
      sweepX[sweepN] = _p.x;
      sweepZ[sweepN] = _p.z;
      sweepTX[sweepN] = _p.tx;
      sweepTZ[sweepN] = _p.tz;
      sweepN++;
      sx0 = Math.min(sx0, _p.x);
      sx1 = Math.max(sx1, _p.x);
      sz0 = Math.min(sz0, _p.z);
      sz1 = Math.max(sz1, _p.z);
    }
  }
  // Gap from the front to a body (centre x, z, heading, half width & length) in the swept path, or Infinity when it is
  // clear of it (or already beside the tram: a collision, not something to brake for; or, with `oncoming` false,
  // facing the tram). Sets _obsV, its speed along the track there.
  let _obsV = 0;
  function obstacleGap(x, z, heading, halfW, halfL, vx, vz, oncoming) {
    const r = halfL + 2;
    if (sweepN === 0 || x < sx0 - r || x > sx1 + r || z < sz0 - r || z > sz1 + r) return Infinity;
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < sweepN; i++) {
      const dx = x - sweepX[i];
      const dz = z - sweepZ[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        k = i;
      }
    }
    const tx = sweepTX[k];
    const tz = sweepTZ[k];
    const dx = x - sweepX[k];
    const dz = z - sweepZ[k];
    const cs = Math.sin(heading) * tx + Math.cos(heading) * tz;
    if (!oncoming && cs < -0.5) return Infinity;
    const c = Math.abs(cs);
    const sn = Math.sqrt(Math.max(0, 1 - c * c));
    if (Math.abs(dx * tz - dz * tx) > TRAM_HALF_WIDTH + halfW * c + halfL * sn + 0.05) return Infinity;
    const gap = k * SWEEP_STEP + dx * tx + dz * tz - (halfL * c + halfW * sn);
    if (gap < -1) return Infinity;
    _obsV = Math.max(0, vx * tx + vz * tz);
    return gap;
  }
  // The player this frame (set in update; active as traffic.js has it: on the ground and not flying)
  const player = { active: false, entity: null, x: 0, z: 0, heading: 0, vx: 0, vz: 0, halfW: 0.86, halfL: 2.18 };

  function drive(t, elapsed) {
    const path = t.path;
    const u = path.u;
    const ic = path.indexAt(u);
    const here = path.edges[ic];
    _v = t.speed;
    _v0 = Math.max(1, (here.street ? STREET_SPEED : TRACK_SPEED) * t.v0Factor);
    t.v0 = _v0;
    _acc = D.a * (1 - (_v / _v0) ** 4);
    _reason = '';
    let gapMin = Infinity;
    let leader = null;

    // Dead end ahead: a buffer stop
    if (path.end < Infinity) consider(wall(path.end - u - path.edges[path.n - 1].endPad), 'end');

    // Trams ahead on this path (their rear), or head-on on two-way track (a stopped obstacle)
    for (const o of pool) {
      if (o === t || !o.active) continue;
      if (Math.abs(o.x - t.x) > LOOKAHEAD + 40 || Math.abs(o.z - t.z) > LOOKAHEAD + 40) continue;
      for (let j = ic; j < path.n; j++) {
        const sj = path.start[j];
        if (sj - u > LOOKAHEAD) break;
        const e = path.edges[j];
        for (let k = 0; k < o.occN; k++) {
          const oe = o.occEdge[k];
          // back: its nearest point ahead along this path; ahead: its furthest (behind our front: a follower)
          let back;
          let ahead;
          let headOn = false;
          if (oe === e) {
            back = sj + o.occS0[k];
            ahead = sj + o.occS1[k];
            // its rear still on another branch of a switch here: keep clear of the fouling point
            if (o.occS0[k] === 0 && (j === ic || !occupies(o, path.edges[j - 1])) && k > 0) {
              back -= j > ic ? path.edges[j - 1].foulEnd : FOUL;
            }
          } else if (oe === e.reverse && e.reverse) {
            back = sj + e.len - o.occS1[k];
            ahead = sj + e.len - o.occS0[k];
            headOn = true;
          } else continue;
          if (ahead <= u + 0.01) continue;
          const gap = back - u;
          if (gap < gapMin) {
            gapMin = gap;
            leader = o;
          }
          consider(idm(Math.max(gap, 0.1), headOn ? 0 : o.speed), 'tram');
        }
      }
    }
    // Cars and the player in the way ahead: trams have priority, so this is only safety braking for whoever is
    // still on the track (cars keep off it through traffic.js; the player doesn't have to). Not for cars facing the
    // tram: where a lane runs against the track (contraflow track beside a one-way street, mostly squeezed by
    // defaulted road widths: 0.75 km of it), the cars stop short of the tram's way (traffic.js), and one already in it
    // can't back out, so waiting for it would only lock both up.)
    sweep(t);
    let obstacleGapMin = Infinity;
    t.obstacle = null;
    if (traffic) {
      for (let pass = 0; pass < 2; pass++) {
        const list = pass ? traffic.buses : traffic.cars;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          if (!v.edge) continue;
          const gap = obstacleGap(v.x, v.z, v.yaw + v.yawOffset, v.halfWidth, v.half, v.tx * v.speed + v.vx, v.tz * v.speed + v.vz, false);
          if (gap === Infinity) continue;
          if (gap < gapMin) {
            gapMin = gap;
            leader = null;
          }
          if (gap < obstacleGapMin) {
            obstacleGapMin = gap;
            t.obstacle = v;
          }
          consider(idm(Math.max(gap, 0.1), _obsV), 'car');
        }
      }
    }
    if (player.active) {
      const gap = obstacleGap(player.x, player.z, player.heading, player.halfW, player.halfL, player.vx, player.vz, true);
      if (gap !== Infinity) {
        gapMin = Math.min(gapMin, gap);
        if (gap < obstacleGapMin) t.obstacle = player.entity;
        consider(idm(Math.max(gap, 0.1), _obsV), 'player');
      }
    }
    t.gap = gapMin;
    t.leader = leader;

    // Switches & crossings ahead: wait before node N while another tram holds it, or reaches it first from another
    // approach (closer, or as close and lower id), unless that tram is ahead on this path anyway
    for (let j = ic + 1; j < path.n; j++) {
      const distA = path.start[j] - u;
      if (distA > CONFLICT_REACH) break;
      const N = path.edges[j].from;
      if (N.in.length < 2 && N.out.length < 2) continue;
      const mine = path.edges[j - 1];
      for (const o of pool) {
        if (o === t || !o.active) continue;
        if (Math.abs(o.x - N.x) > CONFLICT_REACH + 40 || Math.abs(o.z - N.z) > CONFLICT_REACH + 40) continue;
        if (occupies(o, mine) || occupies(o, path.edges[j])) continue; // a leader on this path
        let block = holds(o, N);
        if (!block) {
          const distB = reaches(o, N, distA);
          block = distB >= 0 && _arrive !== mine && (distB < distA || (distB === distA && o.id < t.id));
        }
        if (block) consider(wall(distA - mine.foulEnd), 'switch');
      }
    }

    // Level crossings off the nodes: as switches
    for (let j = ic; j < path.n; j++) {
      const sj = path.start[j];
      if (sj - u > CONFLICT_REACH) break;
      for (const c of path.edges[j].crossings) {
        const distA = sj + c.s - u;
        if (distA <= 0 || distA > CONFLICT_REACH) continue;
        const B = c.other;
        for (const o of pool) {
          if (o === t || !o.active) continue;
          if (Math.abs(o.x - t.x) > CONFLICT_REACH + 80 || Math.abs(o.z - t.z) > CONFLICT_REACH + 80) continue;
          if (crossHeld(o, B, c.os) || crossApproach(o, B, c.os, distA, t.id)) {
            consider(wall(distA - FOUL), 'switch');
            break;
          }
        }
      }
    }

    // Single-track blocks: enter only while no tram is in the block running the other way, or entering it so first
    for (let j = ic + 1; j < path.n; j++) {
      const distA = path.start[j] - u;
      if (distA > LOOKAHEAD) break;
      const e = path.edges[j];
      if (e.run < 0 || path.edges[j - 1].run === e.run) continue;
      for (const o of pool) {
        if (o === t || !o.active) continue;
        if (inRun(o, e.run, -e.runDir) || entersRun(o, e.run, -e.runDir, distA, t.id)) {
          consider(wall(distA - path.edges[j - 1].foulEnd), 'block');
          break;
        }
      }
    }

    // The next stop: the first one ahead on the path not just served; the tram's middle-front stands at the stop
    t.nextStop = null;
    const stopOffset = t.length * 0.35;
    for (let j = ic; j < path.n && !t.nextStop; j++) {
      const sj = path.start[j];
      if (sj - u > LOOKAHEAD) break;
      for (const st of path.edges[j].stops) {
        if (st.stop === t.lastStop) continue;
        const target = sj + st.s + stopOffset;
        if (target < u - 0.5) continue;
        t.nextStop = st.stop;
        t._stopU = target;
        consider(wall(target - u), 'stop');
        break;
      }
    }

    // Signals: hold at the stop line on red, and on amber when there is room to stop
    for (let j = ic; j < path.n; j++) {
      const sj = path.start[j];
      if (sj - u > LOOKAHEAD + 20) break;
      for (const sig of path.edges[j].signals) {
        const gap = sj + sig.s - u;
        if (gap < 0.2 || gap > LOOKAHEAD) continue;
        const phase = signalPhase(elapsed, sig.group === 0);
        if (phase === 'green') continue;
        if (phase === 'amber' && gap < (_v * _v) / (2 * D.bMax) + 1) continue;
        consider(wall(gap - 0.5), 'signal');
      }
    }

    // Curves: approach each tight vertex no faster than its limit
    for (let j = ic; j < path.n; j++) {
      const sj = path.start[j];
      if (sj - u > CURVE_LOOKAHEAD) break;
      const e = path.edges[j];
      const cum = e.cum;
      for (let i = 0; i < cum.length; i++) {
        const vl = e.vmax[i];
        if (vl >= _v0) continue;
        const d = sj + cum[i] - u;
        if (d > CURVE_LOOKAHEAD) break;
        if (d < -t.length) continue;
        if (d <= 0) {
          // under the body: hold the limit
          if (_v > vl) consider(-D.b * Math.min(1, (_v - vl) / 2), 'curve');
          else consider(D.a * (1 - (_v / vl) ** 4), 'curve');
          continue;
        }
        consider(idm(d + D.s0 + vl * D.T, vl), 'curve');
      }
    }
    t.acc = Math.max(-9, _acc);
    t.waitReason = _reason;
  }

  // Integrate, run the stop dwell, keep the path laid out ahead
  function advance(t, dt) {
    const path = t.path;
    if (t.atStop) {
      t.speed = 0;
      t.acc = 0;
      t.dwell -= dt;
      t.doorsOpen = t.dwell > 3;
      if (t.dwell <= 0) {
        t.atStop = false;
        t.doorsOpen = false;
        t.lastStop = t.nextStop;
        t.stopName = '';
      }
      return;
    }
    t.speed = Math.max(0, t.speed + t.acc * dt);
    path.u += t.speed * dt;
    if (path.u > path.end - 0.3) {
      path.u = path.end - 0.3;
      t.speed = 0;
    }
    if (t.nextStop && t.waitReason === 'stop' && t._stopU - path.u < 1.2 && t.speed < 0.3) {
      t.atStop = true;
      t.stopName = t.nextStop.name;
      t.dwell = DWELL_MIN + rand() * DWELL_SPREAD;
      t.speed = 0;
      t.doorsOpen = true;
    }
    path.trim(t.length + 8);
    path.extend(LOOKAHEAD + 20, rand);
  }

  // Instance writes
  const dirtyState = new Set();
  let updates = 0;
  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }
  function writeMatrix(mesh, slot, x, z, heading, scaleZ) {
    const a = mesh.instanceMatrix.array;
    const o = slot * 16;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = s * scaleZ; a[o + 9] = 0; a[o + 10] = c * scaleZ; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = 0.02; a[o + 14] = z; a[o + 15] = 1;
  }
  function writeState(mesh, slot, brake, doors) {
    const st = mesh.geometry.attributes.tramState.array;
    const o = slot * 4;
    if (st[o] !== brake || st[o + 2] !== doors) {
      st[o] = brake;
      st[o + 2] = doors;
      dirtyState.add(mesh);
    }
  }

  function render(t) {
    const secs = t.sections;
    const spec = t.spec;
    const brake = t.acc < -0.6 || t.speed < 0.3 ? 1 : 0;
    const doors = t.doorsOpen ? 1 : 0;
    for (let k = 0; k < secs.length; k++) {
      const s = secs[k];
      const mesh = meshes.get(spec.sections[k].kind);
      const slot = mesh.count++;
      writeMatrix(mesh, slot, s.x, s.z, s.heading, 1);
      writeState(mesh, slot, brake, doors);
      if (k === 0) t._frontMatrix.fromArray(mesh.instanceMatrix.array, slot * 16);
      if (k > 0) {
        // Bellows over the joint, along the mean heading, stretched over the gap (wider on the outside of curves)
        const p = secs[k - 1];
        const jx = (p.rx + s.fx) * 0.5;
        const jz = (p.rz + s.fz) * 0.5;
        let dh = p.heading - s.heading;
        if (dh > Math.PI) dh -= Math.PI * 2;
        else if (dh < -Math.PI) dh += Math.PI * 2;
        const gap = Math.hypot(p.rx - s.fx, p.rz - s.fz);
        writeMatrix(bellows, bellows.count++, jx, jz, s.heading + dh * 0.5, Math.max(1, gap + 0.6 + Math.abs(dh) * 1.2));
      }
    }
  }

  let focusInit = false;
  let lastFX = 0;
  let lastFZ = 0;
  let cursor = 0;

  function update(dt, elapsed, focus, camera, playerEntity = null, activeMode = 'car') {
    // 0. View & focus
    if (camera) {
      camera.updateMatrixWorld();
      camX = camera.position.x;
      camY = camera.position.y;
      camZ = camera.position.z;
      const me = camera.matrixWorld.elements;
      camFwdX = -me[8];
      camFwdZ = -me[10];
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      hasView = true;
    }
    const fx = focus ? focus.x : camX;
    const fz = focus ? focus.z : camZ;
    const jump = !focusInit || Math.hypot(fx - lastFX, fz - lastFZ) > 140;
    focusInit = true;
    lastFX = fx;
    lastFZ = fz;
    refreshNear(fx, fz);
    player.active = !!playerEntity && activeMode !== 'helicopter' && playerEntity.position.y < 2.6;
    if (player.active) {
      const heading = playerEntity.heading || 0;
      const speed = playerEntity.speed || 0;
      player.entity = playerEntity;
      player.x = playerEntity.position.x;
      player.z = playerEntity.position.z;
      player.heading = heading;
      player.vx = Math.sin(heading) * speed + (playerEntity.vx || 0);
      player.vz = Math.cos(heading) * speed + (playerEntity.vz || 0);
      player.halfW = activeMode === 'cyclist' ? 0.35 : activeMode === 'person' ? 0.32 : 0.86;
      player.halfL = activeMode === 'cyclist' ? 0.85 : activeMode === 'person' ? 0.32 : 2.18;
    }

    // 1. Population: retire trams far from the focus, stuck ones and those waiting at a buffer stop out of view;
    //    respawn them near the focus (everything at once after a jump, else a few attempts per frame)
    for (const t of pool) {
      if (!t.active) continue;
      const far = Math.hypot(t.x - fx, t.z - fz) > TRAM_RADIUS;
      const unseen = !nearView(t.x, t.z, 25, 250);
      if (jump || far || (t.deadEndWait > 8 && unseen) || t.deadEndWait > 40 || (t.stuck > 90 && unseen) || t.stuck > 240) {
        t.active = false;
      }
    }
    if (jump) {
      for (const t of pool) {
        for (let attempt = 0; attempt < 30 && !t.active; attempt++) spawn(t, fx, fz, 0, false);
      }
    } else {
      for (let attempt = 0; attempt < 4; attempt++) {
        const t = pool[cursor];
        cursor = (cursor + 1) % pool.length;
        if (!t.active) spawn(t, fx, fz, SPAWN_MIN, true);
      }
    }

    // 2. Driving: occupancy from this frame's positions, then every tram's acceleration, then the moves
    for (const t of pool) if (t.active) occupy(t);
    for (const t of pool) if (t.active) drive(t, elapsed);
    for (const t of pool) {
      if (!t.active) continue;
      advance(t, dt);
      const atEnd = t.path.end < Infinity && t.path.end - t.path.u < t.path.edges[t.path.n - 1].endPad + 1 && t.speed < 0.2;
      t.deadEndWait = atEnd ? t.deadEndWait + dt : 0;
      t.stuck = t.speed < 0.1 && !t.atStop ? t.stuck + dt : 0;
    }

    // 3. Poses, the public list, instances & headlight candidates
    for (const m of allMeshes) m.count = 0;
    let na = 0;
    let litCount = 0;
    for (const t of pool) {
      if (!t.active) continue;
      trams[na++] = t;
      poseSections(t.path, t.path.u, t.spec, t.sections);
      placeMid(t);
      t.frontX = t.sections[0].fx;
      t.frontZ = t.sections[0].fz;
      const dx = t.x - camX;
      const dz = t.z - camZ;
      const d2 = dx * dx + dz * dz;
      t._visible = d2 < TRAM_CULL * TRAM_CULL && visible(t.x, t.z, t.length * 0.5 + 6);
      if (!t._visible) continue;
      render(t);
      const fdx = t.frontX - camX;
      const fdz = t.frontZ - camZ;
      const fd = Math.hypot(fdx, camY, fdz);
      if (fd < TRAM_LIGHT_DIST) {
        t._effDist = fd + Math.max(0, 5 - (fdx * camFwdX + fdz * camFwdZ)) * 3.2;
        if (t._effDist < TRAM_LIGHT_DIST) lit[litCount++] = t;
      }
    }
    trams.length = na;

    // Upload the used prefixes; empty meshes keep one zero-scale instance for the first two updates (precompile)
    const hideEmpty = ++updates > 2;
    for (const m of allMeshes) {
      const n = m.count;
      m.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          m.count = 1;
          m.setMatrixAt(0, zero);
          flagRange(m.instanceMatrix, 1);
        }
        continue;
      }
      flagRange(m.instanceMatrix, n);
      if (dirtyState.has(m)) flagRange(m.geometry.attributes.tramState, n);
    }
    dirtyState.clear();

    // 4. Headlights for the nearest trams in view, faded in at dusk (the highway traffic's ramp)
    lit.length = litCount;
    if (litCount > 1) lit.sort(byEffDist);
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = Math.min(1.28, Math.max(0, (glow - 0.6) * 1.45));
    let used = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < litCount && used + 2 <= TRAM_SPOT_POOL; i++) {
        const t = lit[i];
        const k = Math.min(1, Math.max(0, (TRAM_LIGHT_DIST - t._effDist) / (TRAM_LIGHT_DIST * 0.38)));
        const fade = k * k * (3 - 2 * k);
        if (fade <= 0.001) continue;
        for (let side = -1; side <= 1; side += 2) {
          const spot = spots[used++];
          placeVehicleHeadlight(spot, lightSpecs[t.model], side, t._frontMatrix);
          spot.intensity = HEADLIGHTS.busIntensity * beamScale * fade;
        }
      }
    }
    for (let i = used; i < TRAM_SPOT_POOL; i++) {
      spots[i].intensity = 0;
      spots[i].position.set(0, -1000, 0);
    }
  }

  return { group, update, trams, pool, graph, stops: tramStops, signals, models: TRAM_MODELS };
}

export {
  TRAM_MODELS,
  TRAM_DRIVER,
  TRAM_HALF_WIDTH,
  SWITCH_TURN,
  buildTrackGraph,
  edgePoint,
  nearestOnEdge,
  snapTramStops,
  attachTramStops,
  findTrackSignals,
  mapTramsToRoads,
  TramPath,
  poseSections,
  createTramSystem
};
