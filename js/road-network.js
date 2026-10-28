import {
  SIGNAL_SITES,
  isLand,
  BLOCKS
} from './city-config.js';
import { GEO } from './geodata.js';

// js/road-network.js
// Drivable road graph from the street centreline graph (GEO.roadGraph, tools/build-poznan.mjs): junctions, straight
// runs between them and every bend, lanes by each road's real width, lane count and direction that keep clear of the
// curbs, medians and street furniture city-grid.js and street-details.js build, intersections (signalised where
// street-details.js mounts signal heads) and the lane-to-lane curves used to drive straight through them or turn.
// Bridge decks count as land (city-config.js isLand), so the Warta crossings are ordinary links.
//
// Conventions: north = -z, east = +x. Every directed edge has a unit direction (dx, dz) and a right normal
// (rx, rz) = (-dz, dx). Lanes are lateral offsets to the right of the centreline, sorted left to right.

const CELL = 32;
const LANE_CLEAR = 1.2; // half width each lane keeps free of obstacles
const LANE_W = 3.6; // lane spacing
// Between an intersection box and its stop lines: the crosswalk band right at the box, a P-10 zebra 4 m deep (the
// Polish minimum on most streets) and a 0.15 m margin each side (road-paint.js), then STOP_SETBACK to the stop line
// (the edge end). The P-14 line is painted 0.1-0.6 m inside the edge end, so 1.75 m leaves the 2.0 m of asphalt between
// it and the zebra that the annex on horizontal signs asks for (Dz.U. 2019 poz. 2311, załącznik nr 2, 4.2.5).
const CROSSWALK = 4.3;
const STOP_SETBACK = 1.75;
// How far past a road's curb, as its half width puts it, a zebra may run on to reach the real curb island (the half
// width of a merged junction's arm or a divided road's two roadways can fall a few metres short of the real curbs):
// pedestrian-routes.js lays crosswalks only where both ends find a curb island within it, road-paint.js paints them
// and street-details.js keeps their landings clear
const CROSSWALK_REACH = 4;
const SHORE_MARGIN = 6;
// A major road (buses spawn on it): at least 14.5 m curb to curb (four lanes and some) or with three travel lanes or
// more (OSM lanes, both ways). The graph carries no road class, so width and lanes stand in for primary/secondary.
const MAJOR_WIDTH = 14.5;
const isMajorRoad = (width, lanes) => width >= MAJOR_WIDTH || lanes >= 3;
// km/h: the Polish built-up limit, for a link without one (the geodata gives every Poznań link its OSM or class limit)
const DEFAULT_KMH = 50;
// GEO.roadGraph link flags: the tram strip, TRAM_W of the link's width (tools/poz-roads.mjs), lies right / left of a -> b,
// beside the carriageway the link's points follow (a divided road's median tracks)
const TRAM_RIGHT = 8;
const TRAM_LEFT = 16;
const TRAM_W = 6.5;
// Signal sites (OSM traffic_signals nodes) further than this from the junction they belong to are not one of its own:
// the graph merges a divided road's corners into one junction up to ~14 m across (2.)
const SIGNAL_REACH = 12;
// How far a straight run may stray from the real centreline it stands for before it gets a shape node (2.), past the
// CHORD_END metres at its ends that the lane test leaves out (3.)
const CHORD_DEV = 0.5;
const CHORD_END = 12;
// ...and the nearest a shape node for that may come to a junction: a run from a bend into a junction shorter than the
// junction's stop-line setback (up to 26 m, 24.3 m once a short link gives up STOP_SETBACK) gets squeezed and dropped
// (4.), which breaks more than the stray costs
const JUNCTION_END = 25;
// The furthest an edge ends before a bend where its lanes shift sideways (4.)
const SHIFT_BACK = 7;
// Two one-way roadways of a divided road drawn closer than this (centreline to centreline) share one centreline (3.)
const PAIR_SEP = 4;

function buildRoadNetwork(sidewalks, obstacles) {
  // 1. Spatial hash of ground footprints: curbs bound the roads, everything else also blocks pedestrians
  const hash = new Map();
  const cellKey = (ix, iz) => (ix + 512) * 1024 + iz + 512;

  function insert(r) {
    for (let ix = Math.floor(r.minX / CELL); ix <= Math.floor(r.maxX / CELL); ix++) {
      for (let iz = Math.floor(r.minZ / CELL); iz <= Math.floor(r.maxZ / CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(r);
      }
    }
  }
  for (const r of sidewalks) insert({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, curb: true });
  for (const r of obstacles) insert(r);

  // Calls fn(rect) for every footprint overlapping the box until fn returns true
  function query(minX, maxX, minZ, maxZ, fn) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const list = hash.get(cellKey(ix, iz));
        if (!list) continue;
        for (const r of list) {
          if (r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && fn(r)) return true;
        }
      }
    }
    return false;
  }

  // All four corners at least SHORE_MARGIN in from the water (bridge decks are land all across)
  function onLand(minX, maxX, minZ, maxZ) {
    return isLand(minX, minZ, SHORE_MARGIN) && isLand(maxX, minZ, SHORE_MARGIN) &&
      isLand(minX, maxZ, SHORE_MARGIN) && isLand(maxX, maxZ, SHORE_MARGIN);
  }

  const walkable = (minX, maxX, minZ, maxZ) => onLand(minX, maxX, minZ, maxZ) && !query(minX, maxX, minZ, maxZ, (r) => !r.curb);
  // Lanes follow the real streets: the rectangles standing in for irregular sidewalks may reach a little past their
  // curbs, and the footprints city-grid.js hands over for median islands and park blocks are their bounding boxes,
  // which on a turned block take in the streets around it. So only a curb right at (x, z), medians by their real
  // outline and other obstacles under 50 m across count; a park block's box is no obstacle (park blocks hand over no
  // curb rects either, and OSM runs some service roads through them).
  const OUTLINED = BLOCKS.filter((b) => b.median);
  const boxKey = (r) => [r.minX, r.maxX, r.minZ, r.maxZ].map((v) => Math.round(v * 2)).join(',');
  const outlineBoxes = new Set(BLOCKS.filter((b) => b.median || b.park > 0.6).map(boxKey));
  const outlineCells = new Map(); // 64 m cells -> the outlined blocks reaching into them
  for (const b of OUTLINED) {
    for (let ix = Math.floor((b.minX - 2) / 64); ix <= Math.floor((b.maxX + 2) / 64); ix++) {
      for (let iz = Math.floor((b.minZ - 2) / 64); iz <= Math.floor((b.maxZ + 2) / 64); iz++) {
        const k = ix * 100000 + iz;
        if (!outlineCells.has(k)) outlineCells.set(k, []);
        outlineCells.get(k).push(b);
      }
    }
  }
  function nearOutline(x, z, clear) {
    for (const b of outlineCells.get(Math.floor(x / 64) * 100000 + Math.floor(z / 64)) || []) {
      const c = clear;
      if (x < b.minX - c || x > b.maxX + c || z < b.minZ - c || z > b.maxZ + c) continue;
      let inside = false;
      const P = b.poly;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i];
        const q = P[j];
        if ((a.z > z) !== (q.z > z) && x < ((q.x - a.x) * (z - a.z)) / (q.z - a.z) + a.x) inside = !inside;
        const ex = q.x - a.x;
        const ez = q.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < c) return true;
      }
      if (inside) return true;
    }
    return false;
  }
  const blockedOnStreet = (x, z, clear) => !onLand(x - clear, x + clear, z - clear, z + clear) ||
    query(x - 0.3, x + 0.3, z - 0.3, z + 0.3, (r) => r.curb) ||
    nearOutline(x, z, clear) ||
    query(x - clear, x + clear, z - clear, z + clear, (r) => !r.curb && (r.maxX - r.minX < 50 || r.maxZ - r.minZ < 50) && !outlineBoxes.has(boxKey(r)));

  // 2. Streets from the centreline graph: junctions (graph nodes a few metres apart merged into one) and straight runs
  //    between them, with a shape node at every bend, so every edge stays straight
  let nodes = [];
  const genRuns = streetRuns();
  function streetRuns() {
    const RG = GEO.roadGraph;
    const runs = [];
    const pos = [];
    for (let i = 0; i < RG.nodes.length; i += 2) pos.push({ x: RG.nodes[i], z: RG.nodes[i + 1] });
    const links = [];
    const roads = new Map(); // street name -> { len, majorLen, widths: [[w, len]], width, major }
    for (const [a, b, ni, w, lanes, dir, inner, flags, kmh] of RG.links) {
      let pts = [pos[a]];
      for (let k = 0; k < inner.length; k += 2) pts.push({ x: inner[k], z: inner[k + 1] });
      pts.push(pos[b]);
      // With the tram strip beside the carriageway, the roadway (carriageway and strip, as tools/poz-blocks.mjs stamps
      // it between the curbs) runs TRAM_W / 2 to the strip's side of the points, and the lanes keep to the carriageway
      // (lanesOf)
      const strip = flags & TRAM_RIGHT ? 1 : flags & TRAM_LEFT ? -1 : 0;
      if (strip) pts = offsetLine(pts, strip * TRAM_W / 2);
      let len = 0;
      for (let k = 0; k + 1 < pts.length; k++) len += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
      const r = roads.get(RG.names[ni]) || { len: 0, majorLen: 0, widths: [] };
      roads.set(RG.names[ni], r);
      r.len += len;
      if (w > 3) {
        r.widths.push([w, len]);
        if (isMajorRoad(w, lanes)) r.majorLen += len;
      } else if (lanes >= 3) r.majorLen += len;
      links.push({ a, b, name: RG.names[ni], w, lanes, dir, pts, len, limit: (kmh || DEFAULT_KMH) / 3.6, strip });
    }
    // Each named road's links: their length-weighted median width stands in where a link has none, and a road that is
    // major over most of its length is major throughout, so that its narrower stretches keep its buses
    for (const r of roads.values()) {
      r.widths.sort((p, q) => p[0] - q[0]);
      const measured = r.widths.reduce((s, [, len]) => s + len, 0);
      let acc = 0;
      for (const [w, len] of r.widths) {
        r.width = w;
        if ((acc += len) >= measured / 2) break;
      }
      r.major = r.majorLen >= r.len / 2;
    }
    // Junctions a few metres apart (divided roads, offset corners) are one: collapse links under 14 m
    const parent = pos.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of links) if (l.len < 14) parent[find(l.a)] = find(l.b);
    const sum = new Map();
    const counted = new Set();
    for (const l of links) {
      for (const i of [l.a, l.b]) {
        if (counted.has(i)) continue;
        counted.add(i);
        const r = find(i);
        const s = sum.get(r) || { x: 0, z: 0, n: 0 };
        s.x += pos[i].x;
        s.z += pos[i].z;
        s.n++;
        sum.set(r, s);
      }
    }
    const junctions = new Map();
    function junction(r) {
      let node = junctions.get(r);
      if (!node) {
        const s = sum.get(r);
        node = { x: s.x / s.n, z: s.z / s.n, signal: false, in: [], out: [] };
        nodes.push(node);
        junctions.set(r, node);
      }
      return node;
    }
    // Lanes by the road's real curb-to-curb width, its OSM lane count (both ways) and direction of travel, LANE_W
    // apart and each LANE_CLEAR inside the curbs: a one-way road's lanes centred on it, a two-way road's from 1.8 m right
    // of the centreline, half of them (at least one) each way. Major roads (see roads above) count as avenues.
    // With a tram strip beside it, the lanes keep to the carriageway: its centre lies c right of the roadway's (a -> b).
    function lanesOf(l) {
      const road = roads.get(l.name);
      const w = l.w > 3 ? l.w : road.width || 9.1;
      const half = w / 2;
      const car = l.strip ? half - TRAM_W / 2 : half; // the carriageway's half width
      const c = -l.strip * TRAM_W / 2;
      const major = isMajorRoad(w, l.lanes) || road.major;
      const axis = major ? 'ave' : 'st';
      if (l.dir !== 0) {
        const n = Math.max(1, Math.min(l.lanes || 1, Math.floor((car - LANE_CLEAR) / (LANE_W / 2)) + 1));
        const lanes = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * LANE_W + c * l.dir);
        return { half, axis, major, limit: l.limit, fwd: l.dir > 0 ? lanes : [], back: l.dir < 0 ? lanes : [] };
      }
      const n = Math.max(1, Math.min(Math.round((l.lanes || 2) / 2), Math.floor((car - LANE_CLEAR + LANE_W / 2) / LANE_W)));
      // a road too narrow for a full lane each way (two-way service roads and lanes from ~3.3 m) keeps both to it
      const first = Math.min(LANE_W / 2, car / 2);
      const each = Array.from({ length: n }, (_, k) => first + k * LANE_W);
      return { half, axis, major, limit: l.limit, fwd: each.map((o) => o + c), back: each.map((o) => o - c) };
    }
    const DEG = Math.PI / 180;
    for (const l of links) {
      const A = junction(find(l.a));
      const B = junction(find(l.b));
      if (A === B) continue;
      const pts = [{ x: A.x, z: A.z }, ...l.pts.slice(1, -1), { x: B.x, z: B.z }];
      // stations along it: the ends and every bend over 12° at least 15 m from the last station and from the far end
      const at = [0]; // indices into pts
      let last = pts[0];
      let rest = l.len;
      for (let k = 1; k < pts.length - 1; k++) {
        const p1 = pts[k];
        const p2 = pts[k + 1];
        const d0 = Math.hypot(p1.x - last.x, p1.z - last.z);
        rest -= Math.hypot(p1.x - pts[k - 1].x, p1.z - pts[k - 1].z);
        let turn = Math.abs(Math.atan2(p2.z - p1.z, p2.x - p1.x) - Math.atan2(p1.z - last.z, p1.x - last.x));
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn < 12 * DEG || d0 < 15 || rest < 15) continue;
        at.push(k);
        last = p1;
      }
      at.push(pts.length - 1);
      // ...and wherever the real centreline strays from the straight run between two stations by more than CHORD_DEV
      // (beyond the CHORD_END metres at either end that the lane test skips, 3.): a run cutting across a long gentle
      // arc (60 m of a 12° bend strays ~3 m), or skewed by a junction merged a few metres off the link's own end, puts
      // its outer lane into the furniture street-details.js stands along the real curb. Candidates are the real
      // centreline (l.pts, its own ends included) every 2 m.
      const cand = []; // { x, z, n: its place in the list }
      const first = []; // pts index -> the candidate at that vertex
      for (let k = 0; k + 1 < l.pts.length; k++) {
        const p0 = l.pts[k], p1 = l.pts[k + 1];
        const L = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        first[k] = cand.length;
        for (let t = 0; t < L; t += 2) cand.push({ x: p0.x + (p1.x - p0.x) * t / L, z: p0.z + (p1.z - p0.z) * t / L, n: cand.length });
      }
      first[l.pts.length - 1] = cand.length;
      cand.push({ ...l.pts[l.pts.length - 1], n: cand.length });
      // (the ends measured from the link's own ends, which the runs' ports below line up with)
      const stops = at.map((k, i) => {
        const q = i === 0 ? l.pts[0] : i === at.length - 1 ? l.pts[l.pts.length - 1] : pts[k];
        return { x: q.x, z: q.z, n: first[k] };
      });
      for (let i = 0; i + 1 < stops.length; i++) {
        const a = stops[i], c = stops[i + 1];
        const dx = c.x - a.x, dz = c.z - a.z, L = Math.hypot(dx, dz) || 1;
        let worst = null, dev = CHORD_DEV;
        for (let n = a.n + 1; n < c.n; n++) {
          const q = cand[n];
          if (Math.hypot(q.x - a.x, q.z - a.z) < (i === 0 ? JUNCTION_END : CHORD_END)) continue;
          if (Math.hypot(q.x - c.x, q.z - c.z) < (i + 2 === stops.length ? JUNCTION_END : CHORD_END)) continue;
          const d = Math.abs((q.x - a.x) * dz - (q.z - a.z) * dx) / L;
          if (d > dev) {
            dev = d;
            worst = q;
          }
        }
        if (worst) stops.splice(i-- + 1, 0, worst); // and look at the first half again
      }
      const stations = stops.map((q, i) => {
        if (i === 0) return A;
        if (i === stops.length - 1) return B;
        const s = { x: q.x, z: q.z, signal: false, in: [], out: [], shape: true };
        nodes.push(s);
        return s;
      });
      // Ports: a run into a merged junction ends level with its centre but on the line of the link's own end (the
      // link's last straight slid along itself), not at the centre: the centre of a divided road's or an offset
      // junction's merged corners lies in the median or the tram strip, up to ~7 m off the roadway, and a run skewed
      // into it led the lanes across the median and the tracks and queued cars at an angle before the stop line
      const port = (J, P, Q) => {
        const L = Math.hypot(Q.x - P.x, Q.z - P.z);
        if (L < 1e-6) return { x: J.x, z: J.z };
        const ux = (Q.x - P.x) / L, uz = (Q.z - P.z) / L;
        const t = (J.x - P.x) * ux + (J.z - P.z) * uz;
        return { x: P.x + ux * t, z: P.z + uz * t };
      };
      const ends = stops.length - 1;
      const geo = stops.map((q, i) => (i === 0 ? port(A, q, stops[1]) : i === ends ? port(B, q, stops[ends - 1]) : stations[i]));
      const lanes = lanesOf(l);
      for (let k = 0; k + 1 < stations.length; k++) runs.push({ from: stations[k], to: stations[k + 1], p0: geo[k], p1: geo[k + 1], ...lanes });
    }
    return runs;
  }

  // 3. Directed edges between nodes, keeping only the lanes clear of obstacles node to node. A street runs in any
  //    direction, so its lanes are checked for obstacles every 2.5 m (clear of the junctions, where neighbouring corners
  //    would get in the way of the test) instead of over one bounding box
  let edges = [];
  const laneOpen = (x0, z0, dx, dz, span, o) => {
    const clear = Math.min(CHORD_END, span / 2);
    for (let t = clear; t <= span - clear + 1e-6; t += 2.5) {
      if (blockedOnStreet(x0 + dx * t - dz * o, z0 + dz * t + dx * o, LANE_CLEAR)) return false;
    }
    return true;
  };
  // From p0 to p1, the run's ports (2.), which lie off the junction nodes `from` and `to` by offFrom / offTo to the right
  function addEdge(from, to, p0, p1, axis, major, lanes, half, divided, limit) {
    const x0 = p0.x;
    const z0 = p0.z;
    const span = Math.hypot(p1.x - x0, p1.z - z0);
    if (span < 8) return;
    const dx = (p1.x - x0) / span;
    const dz = (p1.z - z0) / span;
    const open = lanes.filter((o) => laneOpen(x0, z0, dx, dz, span, o));
    if (!open.length) return;
    const offFrom = (x0 - from.x) * -dz + (z0 - from.z) * dx;
    const offTo = (p1.x - to.x) * -dz + (p1.z - to.z) * dx;
    edges.push({ from, to, axis, major, x0, z0, dx, dz, rx: -dz, rz: dx, span, half, lanes: open.sort((p, q) => p - q), moves: [], cand: lanes, divided: !!divided, limit, offFrom, offTo });
  }
  // A divided road drawn as two one-way roadways between the same two junctions: each keeps its own line (their ports,
  // 2.), and the road counts as major by both roadways' width. Only roadways drawn within PAIR_SEP of each other (on
  // top of each other: no room for a median between their lanes) run both ways along one centreline, the junction
  // centres', each way keeping to the right of it from 1.8 m as on a two-way street, the road as wide as both. Moving
  // every pair onto that centreline put the lanes of roadways 10-25 m apart (Św. Marcin by the Kaponiera, a tram strip
  // between them) onto the median and the tracks.
  const travel = (r) => (r.fwd.length ? [r.from, r.to] : [r.to, r.from]);
  const oneWays = new Map(); // node -> next node -> the one-way run from one to the other
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length) continue;
    const [a, b] = travel(r);
    if (!oneWays.has(a)) oneWays.set(a, new Map());
    oneWays.get(a).set(b, r);
  }
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length || r.divided) continue;
    const [a, b] = travel(r);
    const o = oneWays.has(b) && oneWays.get(b).get(a);
    if (!o || o.divided) continue;
    const L = Math.hypot(r.p1.x - r.p0.x, r.p1.z - r.p0.z) || 1;
    const sep = Math.abs(((o.p0.x + o.p1.x) / 2 - r.p0.x) * (r.p1.z - r.p0.z) - ((o.p0.z + o.p1.z) / 2 - r.p0.z) * (r.p1.x - r.p0.x)) / L;
    if (2 * (r.half + o.half) >= MAJOR_WIDTH) {
      r.axis = o.axis = 'ave';
      r.major = o.major = true;
    }
    r.divided = o.divided = true;
    if (sep >= PAIR_SEP) continue;
    for (const q of [r, o]) {
      q.p0 = { x: q.from.x, z: q.from.z };
      q.p1 = { x: q.to.x, z: q.to.z };
      const lanes = q.fwd.length ? q.fwd : q.back;
      const right = lanes.map((x) => x - lanes[0] + 1.8); // as on a two-way street, from 1.8 m right of the centreline
      if (q.fwd.length) q.fwd = right;
      else q.back = right;
    }
    r.half = o.half = r.half + o.half;
  }
  for (const r of genRuns) {
    if (r.fwd.length) addEdge(r.from, r.to, r.p0, r.p1, r.axis, r.major, r.fwd, r.half, r.divided, r.limit);
    if (r.back.length) addEdge(r.to, r.from, r.p1, r.p0, r.axis, r.major, r.back, r.half, r.divided, r.limit);
  }
  // Two edges from one node to the same next one (a service road whose ends were drawn onto its main road's junctions)
  // would drive through each other: keep the one with the most lanes
  const keptEdge = new Map();
  const edgeRank = (e) => e.lanes.length * 10 + e.half / 100;
  for (const e of edges) {
    let to = keptEdge.get(e.from);
    if (!to) keptEdge.set(e.from, (to = new Map()));
    const o = to.get(e.to);
    if (!o || edgeRank(e) > edgeRank(o)) to.set(e.to, e);
  }
  edges = edges.filter((e) => keptEdge.get(e.from).get(e.to) === e);
  // ...and where only some of the junctions on both sides of its median became one, the stretches of its two
  // roadways that run on top of each other the same way
  {
    const oneWay = edges.filter((e) => !e.divided && e.cand[0] <= 0); // lanes about its centreline
    const cells = new Map(); // 16 m cells -> the one-way edges passing within 4 m
    oneWay.forEach((e, i) => {
      e.oneWay = i;
      for (let t = 0; t <= e.span; t += 8) {
        const x = e.x0 + e.dx * t;
        const z = e.z0 + e.dz * t;
        for (let ix = Math.floor((x - 4) / 16); ix <= Math.floor((x + 4) / 16); ix++) {
          for (let iz = Math.floor((z - 4) / 16); iz <= Math.floor((z + 4) / 16); iz++) {
            const k = (ix + 4096) * 8192 + (iz + 4096);
            const list = cells.get(k);
            if (!list) cells.set(k, [e]);
            else if (list[list.length - 1] !== e) list.push(e);
          }
        }
      }
    });
    // metres of e along f whose lanes come within 3 m of f's (e's right is f's left)
    const onTop = (e, f) => {
      let hits = 0;
      for (let t = 0; t <= e.span; t += 2) {
        const px = e.x0 + e.dx * t - f.x0;
        const pz = e.z0 + e.dz * t - f.z0;
        const u = px * f.dx + pz * f.dz;
        if (u < 0 || u > f.span) continue;
        const side = px * f.rx + pz * f.rz;
        if (e.lanes.some((a) => f.lanes.some((b) => Math.abs(side - a - b) < 3))) hits += 2;
      }
      return hits;
    };
    const partner = new Map(); // edge -> half width of the widest roadway running the other way on top of it
    const between = new Map(); // edge -> how far right of it the nearest such roadway's line runs (negative: left)
    // (f's line, right of e: e's midpoint right of f's own, in f's frame turned the other way)
    const offsetOf = (e, f) => (e.x0 + e.dx * e.span / 2 - f.x0) * f.rx + (e.z0 + e.dz * e.span / 2 - f.z0) * f.rz;
    const near = (m, e, q) => {
      if (!m.has(e) || Math.abs(q) < Math.abs(m.get(e))) m.set(e, q);
    };
    const tested = new Set();
    for (const list of cells.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const e = list[i];
          const f = list[j];
          if (e.dx * f.dx + e.dz * f.dz > -0.94) continue; // the other way, within 20°
          const key = Math.min(e.oneWay, f.oneWay) * 65536 + Math.max(e.oneWay, f.oneWay);
          if (tested.has(key)) continue;
          tested.add(key);
          if (Math.max(onTop(e, f), onTop(f, e)) < 6) continue;
          partner.set(e, Math.max(partner.get(e) || 0, f.half));
          partner.set(f, Math.max(partner.get(f) || 0, e.half));
          near(between, e, offsetOf(e, f));
          near(between, f, offsetOf(f, e));
        }
      }
    }
    // Each way keeps to the right of the line midway between the two from 1.8 m, as on a two-way street: from 1.8 m right
    // of its own line, the lanes of two roadways drawn 3-6 m apart ran up to a lane's width past the outer curbs
    for (const [e, other] of partner) {
      const mid = Math.min(0, between.get(e) / 2);
      e.lanes = e.cand.map((o) => o - e.cand[0] + 1.8 + mid).filter((o) => laneOpen(e.x0, e.z0, e.dx, e.dz, e.span, o));
      e.half += other;
      if (2 * e.half >= MAJOR_WIDTH) {
        e.axis = 'ave';
        e.major = true;
      }
      e.divided = true;
    }
    edges = edges.filter((e) => e.lanes.length);
  }
  // Edges no vehicle could both reach and leave (dead ends, and roads reached only from them) are dropped once the
  // moves are known (5.); know them already, so that no road keeps clear of a dead one merging with it or forking off it
  {
    const outsOf = new Map();
    for (const e of edges) {
      if (!outsOf.has(e.from)) outsOf.set(e.from, []);
      outsOf.get(e.from).push(e);
    }
    const live = largestComponent(edges, (e) => (outsOf.get(e.to) || []).filter((f) => f.to !== e.from && e.dx * f.dx + e.dz * f.dz >= -0.5));
    for (const e of edges) e.live = live.has(e);
  }
  const liveArm = (a) => !!((a.in && a.in.live) || (a.out && a.out.live));

  // The roads meeting at each node ("arms": one per direction a road leaves it in), from the edges into and out of it:
  // { ux, uz } (unit, away from the node), half (the widest roadway's half width), ave (a major road's), and its edge
  // `in` and edge `out`, if any. The two ways of a two-way street share an arm, and so do the two one-way roadways of a
  // divided road (within 20° of each other); a second road arriving or leaving within 20° of another (where streets
  // merge or fork) gets an arm of its own. With `only`, for just the nodes in that set.
  function computeArms(list, only = null) {
    for (const n of only || nodes) n.arms = [];
    const ends = new Map(); // node -> the edge ends there, in the order the edges come
    list.forEach((e, i) => {
      for (const [n, role, ux, uz] of [[e.from, 'out', e.dx, e.dz], [e.to, 'in', -e.dx, -e.dz]]) {
        if (only && !only.has(n)) continue;
        if (role === 'out') e.outArm = null;
        else e.inArm = null;
        if (!ends.has(n)) ends.set(n, []);
        ends.get(n).push({ e, role, ux, uz, order: 2 * i + (role === 'in' ? 1 : 0) });
      }
    });
    const armed = (q) => (q.role === 'out' ? q.e.outArm : q.e.inArm);
    for (const [n, at] of ends) {
      // arms in the order of their first edge end, each pointing along it
      const newArm = (q) => {
        const a = { ux: q.ux, uz: q.uz, half: 0, ave: false, in: null, out: null, order: q.order };
        n.arms.push(a);
        return a;
      };
      const join = (a, q) => {
        a[q.role] = q.e;
        if (q.role === 'out') q.e.outArm = a;
        else q.e.inArm = a;
        // as far out as its roadway reaches from the node: a port (2.) moves it off the node
        a.half = Math.max(a.half, q.e.half + Math.abs(q.role === 'out' ? q.e.offFrom : q.e.offTo));
        a.ave = a.ave || q.e.axis === 'ave';
        a.order = Math.min(a.order, q.order);
      };
      // both ways of a two-way street
      for (const q of at) {
        if (q.role !== 'out') continue;
        const r = at.find((p) => p.role === 'in' && p.e.from === q.e.to);
        if (!r) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // one-way roadways within 20°, one each way: a divided road's, the best aligned first
      const pairs = [];
      for (const q of at) {
        if (q.role !== 'out' || armed(q)) continue;
        for (const r of at) {
          const d = q.ux * r.ux + q.uz * r.uz;
          if (r.role === 'in' && !armed(r) && d > 0.94) pairs.push([d, q, r]);
        }
      }
      pairs.sort((p, q) => q[0] - p[0]);
      for (const [, q, r] of pairs) {
        if (armed(q) || armed(r)) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // and every other road alone
      for (const q of at) if (!armed(q)) join(newArm(q), q);
      n.arms.sort((a, b) => a.order - b.order);
      // an arm within 20° of an earlier one (where roads merge or fork) crosses the other roads as one with it (its
      // lead), as wide as the widest of them
      for (const a of n.arms) {
        a.lead = n.arms.find((b) => b.lead === b && b.ux * a.ux + b.uz * a.uz > 0.94) || a;
        a.lead.wide = Math.max(a.lead === a ? 0 : a.lead.wide, a.half);
      }
    }
  }
  computeArms(edges);
  // A centreline node where just one road goes on, bending less than 35°, is a shape node: no corner to stop at (nor a
  // fork: a road splitting in two live ones within 20°)
  const bends = (n) => {
    const leads = n.arms.filter((a) => a.lead === a);
    const forks = leads.some((l) => n.arms.filter((a) => a.lead === l && liveArm(a)).length > 1);
    return leads.length === 2 && leads[0].ux * leads[1].ux + leads[0].uz * leads[1].uz < -0.82 && !forks;
  };
  for (const n of nodes) if (!n.shape && bends(n)) n.shape = true;
  // Where two roads leave a node within 20° of each other (they merge or fork there), how far out every lane of one
  // first keeps 3 m (a car's width and some) from every lane of the other
  const lanesOut = (a, r, out) => {
    out.length = 0;
    for (const e of [a.in, a.out]) {
      if (!e || !e.live) continue;
      const t = e === a.out ? r : e.span - r; // r from its start leaving, r before its end arriving
      for (const o of e.lanes) out.push(e.x0 + e.dx * t + e.rx * o, e.z0 + e.dz * t + e.rz * o);
    }
    return out;
  };
  const lanesA = [];
  const lanesB = [];
  function apart(a, b) {
    for (let r = 2; r < 45; r++) {
      lanesOut(a, r, lanesA);
      lanesOut(b, r, lanesB);
      let near = Infinity;
      for (let i = 0; i < lanesA.length; i += 2) {
        for (let j = 0; j < lanesB.length; j += 2) near = Math.min(near, Math.hypot(lanesA[i] - lanesB[j], lanesA[i + 1] - lanesB[j + 1]));
      }
      if (near >= 3) return r;
    }
    return 45;
  }
  // How far before node n an edge arriving along `arm` stops: clear of every road crossing it (at whatever angle: its
  // curb corner reaches past the crossing road's far side by half its own width over the tangent) plus the crosswalk and
  // the stop-line setback behind it, and clear of the lanes of a road merging with it or forking off it
  const goesOn = (p, q) => p.ux * q.ux + p.uz * q.uz < 0 && Math.abs(p.ux * q.uz - p.uz * q.ux) < 0.26; // q within 15° of straight on from p
  // At a bend (shape node) the road goes on, so its edges end 1 m before it, unless its lane count changes there (OSM
  // splits a way where it does) and the lanes, centred on each roadway, shift sideways: then both edges end 3 m back per
  // metre of shift, up to SHIFT_BACK, so the cars change over along a gentle S-bend (~8° for a 1.8 m shift) rather than
  // a 2 m kink at ~40°
  const laneShift = (e, f) => {
    let worst = 0;
    for (const o of e.lanes) worst = Math.max(worst, Math.min(...f.lanes.map((p) => Math.abs(p - o))));
    for (const p of f.lanes) worst = Math.max(worst, Math.min(...e.lanes.map((o) => Math.abs(p - o))));
    return worst;
  };
  function bendBack(n, arm) {
    let shift = 0;
    for (const b of n.arms) {
      if (b === arm) continue;
      if (arm.in && b.out && b.out.to !== arm.in.from) shift = Math.max(shift, laneShift(arm.in, b.out));
      if (arm.out && b.in && b.in.from !== arm.out.to) shift = Math.max(shift, laneShift(b.in, arm.out));
    }
    return shift > 0.5 ? Math.min(SHIFT_BACK, 1 + 3 * shift) : 1;
  }
  function stopBack(n, arm) {
    if (n.shape) return bendBack(n, arm);
    const a = arm.lead;
    let ext = 0;
    let fork = 0;
    for (const b of n.arms) {
      if (b === arm) continue;
      if (b.lead === a) {
        if (liveArm(arm) && liveArm(b)) fork = Math.max(fork, apart(arm, b) + 1); // side by side rather than across
        continue;
      }
      if (b.lead !== b) continue; // crossing as one with its lead
      // the same road going on (into either of two roads forking there, or out of either of two merging)
      if (n.arms.some((p) => p.lead === a && n.arms.some((q) => q.lead === b && goesOn(p, q)))) continue;
      const cos = a.ux * b.ux + a.uz * b.uz;
      const sin = Math.abs(a.ux * b.uz - a.uz * b.ux);
      ext = Math.max(ext, (b.wide + a.wide * Math.abs(cos)) / sin);
    }
    return Math.max(ext > 0 ? Math.min(ext, 20) + CROSSWALK + STOP_SETBACK : 2, fork);
  }

  // Edges run between stop lines: clear of the roads crossing them and the crosswalk at both ends. On a short link
  // between acute corners, keeping at least 10 m (or half the link) to queue on, the stop lines first close up to their
  // zebras (setbackFrom/To: from the stop line to the CROSSWALK band, which road-paint.js, pedestrian-routes.js and
  // traffic.js put there), so the zebras stay by the junction; then both setbacks pull in together, zebras and all.
  function place(e) {
    let b0 = stopBack(e.from, e.outArm);
    let b1 = stopBack(e.to, e.inArm);
    let g0 = e.from.shape ? 0 : Math.min(STOP_SETBACK, b0);
    let g1 = e.to.shape ? 0 : Math.min(STOP_SETBACK, b1);
    const keep = Math.min(10, e.span * 0.5);
    const short = Math.min(keep - (e.span - b0 - b1), g0 + g1);
    if (short > 0) {
      const k = 1 - short / (g0 + g1);
      b0 -= g0 * (1 - k);
      b1 -= g1 * (1 - k);
      g0 *= k;
      g1 *= k;
    }
    e.setbackFrom = g0;
    e.setbackTo = g1;
    e.squeezed = false;
    if (e.span - b0 - b1 < keep - 1e-9) {
      const k = (e.span - keep) / (b0 + b1);
      b0 *= k;
      b1 *= k;
      e.squeezed = !e.to.shape; // its stop line closer to the roads crossing ahead than they need (see the end of 4.)
    }
    e.sx = e.x0 + e.dx * b0;
    e.sz = e.z0 + e.dz * b0;
    e.len = e.span - b0 - b1;
  }
  for (const e of edges) place(e);
  const placed = edges; // (see 5.)
  const created = edges.length;
  edges = edges.filter((e) => e.len > 4);

  // Paint describes the physical streets, including dead ends and roads AI traffic cannot circulate through.
  // Snapshot their geometry before routing moves stop lines, drops edges and renumbers the surviving junctions.
  // (`signal` is filled in at 6.)
  const paintNodes = new Map(nodes.map((n, id) => [n, { id, x: n.x, z: n.z, shape: n.shape, signal: false }]));
  const paintEdges = edges.map(({ from, to, axis, x0, z0, sx, sz, dx, dz, rx, rz, span, len, setbackFrom, setbackTo, half, lanes,
    limit }) => ({
    from: paintNodes.get(from), to: paintNodes.get(to), axis, x0, z0, sx, sz, dx, dz, rx, rz, span, len, setbackFrom,
    setbackTo, half, lanes, limit
  }));
  const paintOf = new Map(edges.map((e, i) => [e, paintEdges[i]]));

  // 4. Movements at each intersection (no U-turns) and the lane each lane leads to, along obstacle-free curves:
  //    straight on, lane i keeps to lane i + k ahead, k chosen to use as many lanes there as possible with the least
  //    sideways shift; turns go from the lane nearest the turn into the lane nearest it. Lanes left with no way on
  //    (where the road ends or narrows) turn alongside the turn lane, or merge. Across the road, lanes always run
  //    left turns, straight on, right turns, into lanes in the same order, so no two paths from one approach cross.
  const lateral = (e, i) => e.x0 * e.rx + e.z0 * e.rz + e.lanes[i];
  const ORDER = { L: 0, S: 1, R: 2 };
  function pathClear(e, i, f, j) {
    const c = makeCurve(e, i, f, j);
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let k = 1; k < 10; k++) {
      curvePoint(c, c.len * k / 10, p);
      if (blockedOnStreet(p.x, p.z, 0.8)) return false;
    }
    return true;
  }
  function inOrder(e, m, i, j) {
    for (const o of e.moves) {
      for (let k = 0; k < e.lanes.length; k++) {
        if (k === i || o.out[k] < 0) continue;
        // o from k is right of m from i: by its kind of turn, then (two of a kind, where a road forks) by how far right
        // it bends
        const right = ORDER[o.turn] - ORDER[m.turn] || (o === m ? o.out[k] - j : Math.sign(o.cross - m.cross));
        if (k < i ? right > 0 : right < 0) return false;
      }
    }
    return true;
  }
  function nearestLane(e, i, f) {
    let j = 0;
    for (let k = 1; k < f.lanes.length; k++) {
      if (Math.abs(lateral(f, k) - lateral(e, i)) < Math.abs(lateral(f, j) - lateral(e, i))) j = k;
    }
    return j;
  }
  // Let lane i of e make move m into lane j of its edge (clamped to the lanes there), if the way is clear
  function link(e, m, i, j) {
    j = Math.max(0, Math.min(m.to.lanes.length - 1, j));
    if (m.out[i] < 0 && inOrder(e, m, i, j) && pathClear(e, i, m.to, j)) m.out[i] = j;
    return m.out[i] >= 0;
  }
  function serveEveryLane(e) {
    const n = e.lanes.length;
    for (let i = 0; i < n; i++) {
      if (e.moves.some((m) => m.out[i] >= 0)) continue;
      const turnLane = (m, k) => link(e, m, i, m.turn === 'L' ? k : m.to.lanes.length - 1 - k);
      const side = (m) => (m.turn === 'L' ? i : n - 1 - i); // lanes between i and the turn's side of the road
      e.moves.some((m) => m.turn !== 'S' && side(m) <= (n - 1) / 2 && turnLane(m, side(m))) ||
        e.moves.some((m) => m.turn === 'S' && link(e, m, i, nearestLane(e, i, m.to))) ||
        e.moves.some((m) => m.turn !== 'S' && turnLane(m, side(m))) ||
        e.moves.some((m) => m.to.lanes.some((_, j) => link(e, m, i, j)));
    }
    e.moves = e.moves.filter((m) => m.out.some((j) => j >= 0));
  }
  for (const e of edges) e.from.out.push(e);
  for (const e of edges) {
    const n = e.lanes.length;
    for (const f of e.to.out) {
      if (f.to === e.from || e.dx * f.dx + e.dz * f.dz < -0.5) continue;
      const cross = e.dx * f.dz - e.dz * f.dx;
      e.moves.push({ to: f, turn: cross > 0.5 ? 'R' : cross < -0.5 ? 'L' : 'S', cross, out: new Array(n).fill(-1) });
    }
    // the straightest first: where a road forks, the branch going most nearly straight on keeps most of its lanes
    const ahead = (m) => e.dx * m.to.dx + e.dz * m.to.dz;
    for (const m of e.moves.slice().sort((p, q) => ahead(q) - ahead(p))) {
      const f = m.to;
      if (m.turn === 'L') link(e, m, 0, 0);
      else if (m.turn === 'R') link(e, m, n - 1, f.lanes.length - 1);
      else {
        let best = 0;
        let bestScore = -Infinity;
        for (let k = 1 - n; k < f.lanes.length; k++) {
          const used = new Set();
          let score = 0;
          for (let i = 0; i < n; i++) {
            const j = Math.max(0, Math.min(f.lanes.length - 1, i + k));
            used.add(j);
            score -= Math.abs(lateral(f, j) - lateral(e, i));
          }
          score += 100 * used.size;
          if (score > bestScore) {
            bestScore = score;
            best = k;
          }
        }
        for (let i = 0; i < n; i++) link(e, m, i, i + best);
      }
    }
    serveEveryLane(e);
  }

  // Sides & right-of-way groups of node n's arms (see 7.)
  function sidesAndGroups(n) {
    const arms = n.arms;
    arms.forEach((a, i) => (a.side = i));
    n.sideCount = arms.length;
    // roads: arms paired with the one most nearly opposite (beyond 145°), the likeliest pairs first: the straightest,
    // and of two about as straight, the one about as wide (a side street merging into a road nearly head on doesn't
    // take over the road's other side)
    const pairs = [];
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const d = arms[i].ux * arms[j].ux + arms[i].uz * arms[j].uz;
        if (d < -0.82) pairs.push([d + 0.02 * Math.abs(arms[i].half - arms[j].half), arms[i], arms[j]]);
      }
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const mates = new Map();
    for (const [, a, b] of pairs) {
      if (mates.has(a) || mates.has(b)) continue;
      mates.set(a, b);
      mates.set(b, a);
    }
    const roads = [];
    const done = new Set();
    for (const a of arms) {
      if (done.has(a)) continue;
      done.add(a);
      const mate = mates.get(a);
      if (mate) done.add(mate);
      const members = mate ? [a, mate] : [a];
      roads.push({ members, group: -1, rank: Math.max(...members.map((m) => (m.ave ? 100 : 0) + m.half)) });
    }
    // groups go by rank, so group 0 is the widest road; a signal runs two phases, group 0's and the rest's
    roads.sort((p, q) => q.rank - p.rank);
    let groups = 0;
    for (const r of roads) r.group = groups++;
    for (const r of roads) for (const m of r.members) m.group = r.group;
    n.groupCount = Math.max(2, groups);
  }

  // A short link squeezed between two corners may leave its stop line inside the road crossing ahead, where whoever
  // waits on it stands in the way of the traffic crossing there (of other roads, which share the junction with it).
  // Where the link comes off a bend (a shape node: nothing crosses there), its stop line goes back as far as that
  // takes, as long as a car waiting there still stands on the link (not around the bend, in the way of the next);
  // a link that can't keep clear even so is dropped.
  const inOf = new Map();
  for (const e of edges) {
    if (!inOf.has(e.to)) inOf.set(e.to, []);
    inOf.get(e.to).push(e);
  }
  const HALF_CAR = 2.3;
  const HALF_WIDE = 0.95;
  const pathPt = { x: 0, z: 0, dx: 0, dz: 1 };
  function inTheWay(e) {
    const n = e.to;
    sidesAndGroups(n);
    // a car standing at each of its lanes' stop line
    const cars = e.lanes.map((o) => [e.sx + e.dx * (e.len - HALF_CAR) + e.rx * o, e.sz + e.dz * (e.len - HALF_CAR) + e.rz * o]);
    for (const o of inOf.get(n)) {
      if (o === e || o.inArm.group === e.inArm.group) continue;
      for (const m of o.moves) {
        for (let i = 0; i < o.lanes.length; i++) {
          if (m.out[i] < 0) continue;
          const c = makeCurve(o, i, m.to, m.out[i]);
          for (let s = 0; s <= c.len; s += 1) {
            curvePoint(c, s, pathPt);
            for (const [cx, cz] of cars) {
              const dx = pathPt.x - cx;
              const dz = pathPt.z - cz;
              if (dx * dx + dz * dz > 36) continue;
              // how deep a car on the path overlaps it (separating axes)
              let depth = Infinity;
              for (const [ax, az] of [[e.dx, e.dz], [e.rx, e.rz], [pathPt.dx, pathPt.dz], [-pathPt.dz, pathPt.dx]]) {
                const ra = HALF_CAR * Math.abs(e.dx * ax + e.dz * az) + HALF_WIDE * Math.abs(e.rx * ax + e.rz * az);
                const rb = HALF_CAR * Math.abs(pathPt.dx * ax + pathPt.dz * az) + HALF_WIDE * Math.abs(pathPt.dz * ax - pathPt.dx * az);
                depth = Math.min(depth, ra + rb - Math.abs(dx * ax + dz * az));
              }
              if (depth > 0.25) return true;
            }
          }
        }
      }
    }
    return false;
  }
  const inTheWayOut = new Set();
  for (const e of edges) {
    if (!e.squeezed || !e.from.shape || !inTheWay(e)) continue;
    const len = e.len;
    while (e.len > 6 && inTheWay(e)) e.len = Math.max(5.5, e.len - 1);
    e.setbackTo += len - e.len; // the zebra stays where it was
    if (inTheWay(e)) inTheWayOut.add(e); // even so
  }
  if (inTheWayOut.size) {
    edges = edges.filter((e) => !inTheWayOut.has(e));
    for (const e of edges) e.moves = e.moves.filter((m) => !inTheWayOut.has(m.to));
  }

  // 5. Keep the largest strongly connected set of edges so no vehicle can ever reach a dead end
  edges.forEach((e, i) => (e.id = i));
  const visited = new Uint8Array(edges.length);
  const order = [];
  for (const root of edges) {
    if (visited[root.id]) continue;
    visited[root.id] = 1;
    const stack = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const e = top[0];
      if (top[1] < e.moves.length) {
        const f = e.moves[top[1]++].to;
        if (!visited[f.id]) {
          visited[f.id] = 1;
          stack.push([f, 0]);
        }
      } else {
        order.push(e);
        stack.pop();
      }
    }
  }
  const incoming = edges.map(() => []);
  for (const e of edges) for (const m of e.moves) incoming[m.to.id].push(e);
  const comp = new Int32Array(edges.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k].id] >= 0) continue;
    const stack = [order[k]];
    comp[order[k].id] = c;
    let size = 0;
    while (stack.length) {
      const e = stack.pop();
      size++;
      for (const p of incoming[e.id]) {
        if (comp[p.id] < 0) {
          comp[p.id] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = c;
    }
    c++;
  }
  // Any obstacle within LANE_CLEAR of a lane closes that lane over its whole edge (3.), so a street furniture or
  // tram-island rule that crowds the lanes shows up here as a big drop from the edges long enough to the connected ones
  const longEnough = edges.length;
  edges = edges.filter((e) => comp[e.id] === bestComp);
  // Roads kept clear of a road merging with them or forking off them that is gone now (too short, or no way on from it
  // after all) get their stop lines placed again without it
  const kept = new Set(edges);
  const dropped = placed.filter((e) => e.live && !kept.has(e));
  if (dropped.length) {
    const redo = new Set();
    for (const e of dropped) {
      e.live = false;
      redo.add(e.from).add(e.to);
    }
    computeArms(placed, redo);
    for (const n of redo) if (!n.shape && bends(n)) n.shape = true;
    for (const e of edges) if (redo.has(e.from) || redo.has(e.to)) place(e);
  }
  console.info(`[road-network] edges: ${created} with clear lanes, ${longEnough} long enough, ${edges.length} in the largest strongly connected set`);
  for (const e of edges) {
    e.moves = e.moves.filter((m) => comp[m.to.id] === bestComp);
    serveEveryLane(e);
    // Lanes still leading nowhere (every curve out of them grazes a curb or obstacle): send them on to the nearest lane
    // of the straightest move anyway, so every lane always has a way on
    for (let i = 0; i < e.lanes.length; i++) {
      if (!e.moves.length || e.moves.some((m) => m.out[i] >= 0)) continue;
      const m = e.moves.find((q) => q.turn === 'S') || e.moves[0];
      m.out[i] = nearestLane(e, i, m.to);
    }
  }
  edges.forEach((e, i) => (e.id = i));

  for (const n of nodes) n.in = n.out = null;
  for (const e of edges) {
    (e.from.out || (e.from.out = [])).push(e);
    (e.to.in || (e.to.in = [])).push(e);
  }
  nodes = nodes.filter((n) => n.in && n.out);
  nodes.forEach((n, i) => (n.id = i));

  // 6. Signalised intersections are exactly the ones with signal heads: both come from SIGNAL_SITES (city-config.js).
  //    A site marks the nearest junction within SIGNAL_REACH (junction nodes sit at the centre of the graph nodes they
  //    merge, not on any one of them); bends have no corner to stop at
  for (const site of SIGNAL_SITES) {
    let best = null;
    let bestD = SIGNAL_REACH;
    for (const n of nodes) {
      if (n.shape || Math.abs(n.x - site.x) > bestD || Math.abs(n.z - site.z) > bestD) continue;
      const d = Math.hypot(n.x - site.x, n.z - site.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best) best.signal = paintNodes.get(best).signal = true;
  }

  // 7. Sides & right of way at each node, for traffic.js. Its arms are its sides (one crosswalk and approach each),
  //    numbered in the order of their first edge. The arms of one road (on opposite sides) form a group: vehicles of
  //    different groups never share the intersection box, and group 0, the widest road, has the right of way at
  //    unsignalised corners (and the first phase at signals).
  computeArms(edges);
  for (const n of nodes) sidesAndGroups(n);
  for (const e of edges) {
    e.inSide = e.inArm.side; // the side of e.to it arrives over
    e.outSide = e.outArm.side; // the side of e.from it leaves over
    // its right-of-way group at e.to. An unsignalised node with two arms is a bend (or a change of width): nothing
    // crosses there, so both ways are group 0. With the arms more than 35 degrees off straight they were two roads, and
    // one way round each of the 387 bends gave way to the other, crawled at 5 m/s and kept out of the box while the
    // other way was in it (tools/bench-traffic.mjs)
    e.axisIndex = e.to.sideCount < 3 && !e.to.signal ? 0 : e.inArm.group;
    // lateral axis of its road, the same both ways (+x across north-south roads, +z across east-west ones)
    const flip = e.rx < -1e-6 || (Math.abs(e.rx) <= 1e-6 && e.rz < 0);
    e.clx = flip ? -e.rx : e.rx;
    e.clz = flip ? -e.rz : e.rz;
  }
  for (const e of edges) {
    e.opposite = e.to.in.find((o) => o !== e && o.axisIndex === e.axisIndex && o.dx * e.dx + o.dz * e.dz < -0.7) || null;
  }

  // Lane-to-lane curves are built on first use and cached
  const curves = new Map();
  function connector(e, i, f, j) {
    const k = ((e.id * 8 + i) * 16384 + f.id) * 8 + j;
    let c = curves.get(k);
    if (!c) curves.set(k, (c = makeCurve(e, i, f, j)));
    return c;
  }

  // ...but where routing moved a kept edge's stop line (4., 5.), the paint goes where its traffic stops
  for (const e of edges) {
    const p = paintOf.get(e);
    if (p) Object.assign(p, { sx: e.sx, sz: e.sz, len: e.len, setbackFrom: e.setbackFrom, setbackTo: e.setbackTo });
  }

  const isRoadClear = (x, z, clear = 0.15) => !blockedOnStreet(x, z, clear);
  return { nodes, edges, paintEdges, connector, curvePoint, walkable, isRoadClear };
}

// The polyline pts ({x, z}) moved o to its right (mitred, the miter capped at 2o), as new points
function offsetLine(pts, o) {
  const seg = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const L = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z) || 1;
    seg.push({ rx: -(pts[k + 1].z - pts[k].z) / L, rz: (pts[k + 1].x - pts[k].x) / L });
  }
  return pts.map((p, k) => {
    const a = seg[Math.max(0, k - 1)], b = seg[Math.min(seg.length - 1, k)];
    let nx = a.rx + b.rx, nz = a.rz + b.rz;
    const n = Math.hypot(nx, nz) || 1;
    nx /= n;
    nz /= n;
    const m = o / Math.max(0.5, nx * b.rx + nz * b.rz);
    return { x: p.x + nx * m, z: p.z + nz * m };
  });
}

// The largest strongly connected set of `list` (a Set), going on from item e to the items next(e)
function largestComponent(list, next) {
  const index = new Map(list.map((e, i) => [e, i]));
  const succ = list.map((e) => next(e).map((f) => index.get(f)).filter((j) => j !== undefined));
  const pred = list.map(() => []);
  succ.forEach((s, i) => {
    for (const j of s) pred[j].push(i);
  });
  // Kosaraju: finishing order going forwards, then components going backwards from the last finished
  const visited = new Uint8Array(list.length);
  const order = [];
  for (let root = 0; root < list.length; root++) {
    if (visited[root]) continue;
    visited[root] = 1;
    const stack = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] < succ[top[0]].length) {
        const j = succ[top[0]][top[1]++];
        if (!visited[j]) {
          visited[j] = 1;
          stack.push([j, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(list.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k]] >= 0) continue;
    const stack = [order[k]];
    comp[order[k]] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      for (const p of pred[i]) {
        if (comp[p] < 0) {
          comp[p] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  return new Set(list.filter((_, i) => comp[i] === best));
}

// Cubic Bézier from the end of lane i on edge e to the start of lane j on edge f: a quarter-circle-like
// arc around the corner for turns, an S-bend for straight lane shifts. Includes an arc-length table and
// the sharpest curvature along it (1 / tightest radius).
function makeCurve(e, i, f, j) {
  const x0 = e.sx + e.dx * e.len + e.rx * e.lanes[i];
  const z0 = e.sz + e.dz * e.len + e.rz * e.lanes[i];
  const x3 = f.sx + f.rx * f.lanes[j];
  const z3 = f.sz + f.rz * f.lanes[j];
  const cross = e.dx * f.dz - e.dz * f.dx;
  let k0;
  let k3;
  if (Math.abs(cross) < 0.5) {
    k0 = k3 = Math.hypot(x3 - x0, z3 - z0) / 3;
  } else {
    const t = ((x3 - x0) * f.dz - (z3 - z0) * f.dx) / cross;
    k0 = 0.552 * Math.abs(t);
    k3 = 0.552 * Math.hypot(x3 - (x0 + e.dx * t), z3 - (z0 + e.dz * t));
  }
  const c = {
    x0, z0, x3, z3,
    x1: x0 + e.dx * k0, z1: z0 + e.dz * k0,
    x2: x3 - f.dx * k3, z2: z3 - f.dz * k3,
    lut: new Float32Array(17),
    len: 0,
    curv: 0
  };
  let px = x0;
  let pz = z0;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * x3;
    const z = u * u * u * z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * z3;
    c.len += Math.hypot(x - px, z - pz);
    c.lut[k] = c.len;
    px = x;
    pz = z;
    const dx = 3 * u * u * (c.x1 - x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (x3 - c.x2);
    const dz = 3 * u * u * (c.z1 - z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (z3 - c.z2);
    const ddx = 6 * u * (c.x2 - 2 * c.x1 + x0) + 6 * t * (x3 - 2 * c.x2 + c.x1);
    const ddz = 6 * u * (c.z2 - 2 * c.z1 + z0) + 6 * t * (z3 - 2 * c.z2 + c.z1);
    c.curv = Math.max(c.curv, Math.abs(dx * ddz - dz * ddx) / Math.max(1e-6, Math.hypot(dx, dz) ** 3));
  }
  return c;
}

// Position and unit tangent at arc length s along a curve
function curvePoint(c, s, out) {
  let k = 1;
  while (k < 16 && c.lut[k] < s) k++;
  const s0 = c.lut[k - 1];
  const s1 = c.lut[k];
  const t = (k - 1 + Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)))) / 16;
  const u = 1 - t;
  out.x = u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3;
  out.z = u * u * u * c.z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * c.z3;
  const dx = 3 * u * u * (c.x1 - c.x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (c.x3 - c.x2);
  const dz = 3 * u * u * (c.z1 - c.z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (c.z3 - c.z2);
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l;
  out.dz = dz / l;
  return out;
}

export { buildRoadNetwork, CROSSWALK, CROSSWALK_REACH, STOP_SETBACK };
