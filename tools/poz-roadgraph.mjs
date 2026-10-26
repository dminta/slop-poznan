// tools/poz-roadgraph.mjs — GEO.roadGraph for Poznań: the at-grade drivable pieces of poz-roads.mjs as a graph over the
// detail box. Same output layout as geo-roadgraph.mjs (nodes [x, z, ...], names, links with inner shape points) plus a
// trailing `flags` element per link and `signals`.
//
//   nodes:   [x0, z0, x1, z1, ...] (0.1 m)
//   links:   [[a, b, nameIdx, w, lanes, dir, innerFlat, flags, kmh]]; dir 1 = a→b, -1 = b→a, 0 = both;
//            flags bit 0 bridge, bit 1 tram on street, bit 2 roundabout; kmh the speed limit (poz-roads.mjs speedLimit)
//   names:   display names (diacritics as signed; '' for unnamed)
//   signals: [nodeIdx] sorted, unique
import { log, inDetailBox } from './poz-base.mjs';
import { rdp, r1 } from './geo-util.mjs';

const MERGE = 1.0; // m: distinct OSM nodes this close are one graph node (as geo-roadgraph.mjs)
// Pieces whose midpoint lies within this distance of the detail box form the graph. Pieces crossing the margin are kept
// whole, so the graph ends in short dead-end stubs 0-50 m (plus the piece's half length) outside the box rather than
// cut mid-street; the runtime treats them like any dead end.
const GRAPH_PAD = 50;
const SIGNAL_SNAP = 25; // m: straight-line snap of a signal node to a junction (plan §4.2)
const SIGNAL_ALONG = 40; // m: the same along the road, from a stop-line node on a graph piece
const CROSSING_SNAP = 12; // m: a pure pedestrian-crossing signal farther from a junction is a mid-block crossing

const BRIDGE = 1, TRAM = 2, ROUNDABOUT = 4;

function midOf(pts) {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (s + L >= total / 2 && L > 0) {
      const t = (total / 2 - s) / L;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    s += L;
  }
  return pts[0];
}

// pieces: poz-roads.mjs `pieces`; signalNodes: [{ id, x, z, crossing }]. Options: `service` keeps highway=service pieces
// (courtyard and car-park roads: 2/5 of all pieces, nearly all dead ends) in the graph.
export function buildRoadGraph(pieces, signalNodes, { service = false } = {}) {
  const nodes = [];
  const byOsm = new Map(); // OSM node id -> graph node
  const cells = new Map();
  const cellKey = (ix, iz) => ix * 100003 + iz;
  function nodeAt(osmId, x, z) {
    if (byOsm.has(osmId)) return byOsm.get(osmId);
    const ix = Math.floor(x / MERGE), iz = Math.floor(z / MERGE);
    let id = -1;
    for (let dx = -1; dx <= 1 && id < 0; dx++) {
      for (let dz = -1; dz <= 1 && id < 0; dz++) {
        for (const n of cells.get(cellKey(ix + dx, iz + dz)) || []) {
          if (Math.hypot(nodes[n][0] - x, nodes[n][1] - z) <= MERGE) { id = n; break; }
        }
      }
    }
    if (id < 0) {
      id = nodes.length;
      nodes.push([x, z]);
      const k = cellKey(ix, iz);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(id);
    }
    byOsm.set(osmId, id);
    return id;
  }
  const names = [];
  const nameIds = new Map();
  const nameId = (n) => {
    if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); }
    return nameIds.get(n);
  };
  const links = [];
  const linkPieces = [];
  for (const p of pieces) {
    if (!service && p.cls === 'service') continue;
    const [mx, mz] = midOf(p.pts);
    if (!inDetailBox(mx, mz, GRAPH_PAD)) continue;
    const a = nodeAt(p.nodes[0], ...p.pts[0]);
    const b = nodeAt(p.nodes[p.nodes.length - 1], ...p.pts[p.pts.length - 1]);
    if (a === b) continue;
    const flags = (p.bridge ? BRIDGE : 0) | (p.tram ? TRAM : 0) | (p.roundabout ? ROUNDABOUT : 0);
    links.push([a, b, nameId(p.name), p.w, p.lanes, p.dir, rdp(p.pts, 0.4), flags, p.kmh]);
    linkPieces.push(p);
  }

  // Signals: the junction (degree ≥ 3) a signal belongs to. OSM puts most signals on the stop-line node of each
  // approach, not on the junction node. A signal on a kept piece walks the graph from its position along the road
  // (through degree-2 nodes) to the first junction within SIGNAL_ALONG, so a stop line on one carriageway never snaps to
  // a junction of a parallel road; a signal on a junction node is that junction; anything else (or a walk that finds
  // nothing) takes the nearest junction within SIGNAL_SNAP in a straight line. Measured on the 2026-10-25 snapshot: of
  // the 391 signal nodes inside the box, 296 lie within 25 m of a junction in a straight line and 57 within 25-40 m (the
  // stop lines of the wide junctions: Rondo Kaponiera, Most Dworcowy, Królowej Jadwigi), hence the longer walk.
  const deg = new Uint16Array(nodes.length);
  const adj = Array.from({ length: nodes.length }, () => []);
  links.forEach(([a, b, , , , , line], li) => {
    deg[a]++; deg[b]++;
    let L = 0;
    for (let i = 0; i + 1 < line.length; i++) L += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    adj[a].push([b, L, li]);
    adj[b].push([a, L, li]);
  });
  const junctionCells = new Map();
  for (let i = 0; i < nodes.length; i++) {
    if (deg[i] < 3) continue;
    const k = cellKey(Math.floor(nodes[i][0] / SIGNAL_SNAP), Math.floor(nodes[i][1] / SIGNAL_SNAP));
    if (!junctionCells.has(k)) junctionCells.set(k, []);
    junctionCells.get(k).push(i);
  }
  const onPiece = new Map(); // OSM node id -> [[link index, vertex index]]
  linkPieces.forEach((p, li) => p.nodes.forEach((n, vi) => {
    if (!onPiece.has(n)) onPiece.set(n, []);
    onPiece.get(n).push([li, vi]);
  }));
  const along = (pts, i0, i1) => {
    let s = 0;
    for (let i = Math.min(i0, i1); i < Math.max(i0, i1); i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return s;
  };
  // Nearest junction by road distance from seeds [[node, dist]] (a tiny Dijkstra; frontiers hold a handful of nodes)
  function walkToJunction(seeds, limit) {
    const dist = new Map();
    const open = [];
    for (const [n, d] of seeds) if (d <= limit && !(dist.get(n) <= d)) { dist.set(n, d); open.push([d, n]); }
    while (open.length) {
      open.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const [d, n] = open.shift();
      if (d > dist.get(n)) continue;
      if (deg[n] >= 3) return n;
      for (const [m, L] of adj[n]) {
        const dm = d + L;
        if (dm <= limit && !(dist.get(m) <= dm)) { dist.set(m, dm); open.push([dm, m]); }
      }
    }
    return -1;
  }
  const signalSet = new Set();
  let byNode = 0, byAlong = 0, byNear = 0, missed = 0, outside = 0;
  for (const s of signalNodes) {
    const reach = s.crossing ? CROSSING_SNAP : SIGNAL_SNAP;
    if (byOsm.has(s.id) && deg[byOsm.get(s.id)] >= 3) { signalSet.add(byOsm.get(s.id)); byNode++; continue; }
    const seeds = [];
    for (const [li, vi] of onPiece.get(s.id) || []) {
      const p = linkPieces[li];
      seeds.push([links[li][0], along(p.pts, 0, vi)], [links[li][1], along(p.pts, vi, p.pts.length - 1)]);
    }
    let best = seeds.length ? walkToJunction(seeds, s.crossing ? CROSSING_SNAP : SIGNAL_ALONG) : -1;
    if (best >= 0) { signalSet.add(best); byAlong++; continue; }
    let bestD = Infinity;
    const ix = Math.floor(s.x / SIGNAL_SNAP), iz = Math.floor(s.z / SIGNAL_SNAP);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const n of junctionCells.get(cellKey(ix + dx, iz + dz)) || []) {
          const d = Math.hypot(nodes[n][0] - s.x, nodes[n][1] - s.z);
          if (d <= reach && (d < bestD || (d === bestD && n < best))) { best = n; bestD = d; }
        }
      }
    }
    if (best >= 0) { signalSet.add(best); byNear++; } else if (inDetailBox(s.x, s.z)) missed++; else outside++;
  }

  // Keep only the nodes the links use, renumbered in link order
  const used = new Map();
  const outNodes = [];
  const idOf = (i) => {
    if (!used.has(i)) { used.set(i, outNodes.length / 2); outNodes.push(r1(nodes[i][0]), r1(nodes[i][1])); }
    return used.get(i);
  };
  const outLinks = links.map(([a, b, n, w, lanes, dir, line, flags, kmh]) => {
    const ia = idOf(a), ib = idOf(b);
    const inner = line.slice(1, -1).flatMap(([x, z]) => [r1(x), r1(z)]);
    return [ia, ib, n, w, lanes, dir, inner, flags, kmh];
  });
  const signals = [...signalSet].filter((i) => used.has(i)).map((i) => used.get(i)).sort((p, q) => p - q);

  // Connectivity (undirected): component count and the largest one's share of links
  const parent = Array.from({ length: outNodes.length / 2 }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const [a, b] of outLinks) parent[find(a)] = find(b);
  const compLinks = new Map();
  for (const [a] of outLinks) compLinks.set(find(a), (compLinks.get(find(a)) || 0) + 1);
  const largest = Math.max(...compLinks.values());
  const nFlag = (bit) => outLinks.filter((l) => l[7] & bit).length;
  log(`road graph: ${outNodes.length / 2} nodes, ${outLinks.length} links, ${names.length} names; bridge ${nFlag(BRIDGE)}, tram ${nFlag(TRAM)}, roundabout ${nFlag(ROUNDABOUT)} links`);
  log(`road graph: ${compLinks.size} components, the largest holds ${largest} links (${((100 * largest) / outLinks.length).toFixed(1)}%)`);
  // Speed limits by length: the share OSM states, and the length per limit
  let tagLen = 0, allLen = 0;
  const byKmh = {};
  linkPieces.forEach((p, li) => {
    const L = adj[links[li][0]].find((q) => q[2] === li)[1];
    allLen += L;
    if (p.kmhTagged) tagLen += L;
    byKmh[p.kmh] = (byKmh[p.kmh] || 0) + L;
  });
  log(`road graph: speed limits tagged on ${((100 * tagLen) / allLen).toFixed(1)}% of ${(allLen / 1000).toFixed(1)} km; ${Object.entries(byKmh).sort((p, q) => p[0] - q[0]).map(([k, L]) => `${k} km/h ${(L / 1000).toFixed(1)} km`).join(', ')}`);
  log(`road graph: ${signals.length} signalled junctions from ${signalNodes.length} signal nodes (${byNode} on the junction, ${byAlong} along a piece, ${byNear} nearest; ${missed} unsnapped in the box, ${outside} outside)`);
  return { nodes: outNodes, links: outLinks, names, signals };
}
