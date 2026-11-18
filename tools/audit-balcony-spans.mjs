// Full-collider headless audit of every raised signal element against every generated balcony volume: span stays,
// drops, masts and hanging heads, cantilever masts/arms/heads, bridge fascia arms/drops/heads, ground heads and poles,
// plus the static boot-time signal poles and their vehicle and pedestrian heads.
// The balcony records come from buildings.js commit() after placeInFrame has turned them into world coordinates:
// a stack is `landings` slabs, each 1.0 m deep (local z -0.55..0.45, 0.55 m off the facade), `w` wide, from
// y = record.y - 0.14 (slab soffit) to y = record.y + i*storey + 1.0 (railing top). See js/balconies.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MARGIN = Number(argValue('--margin', '0.3'));
// Query radius for the reported "nearest" clearances. Gaps below this are exact; the hit test above only needs
// the margin, so a larger query never changes the intersection count.
const NEAR = Number(argValue('--near', '8'));
const TOP = Number(argValue('--top', '12'));
const before = process.argv.includes('--before');

// The static signal poles and heads live in buildStreetDetails's closure. Record them at the three boot-time push
// points (the per-arm poles, the Dworzec refuge pole, the S-1 heads and the pedestrian heads). Markers are exact
// strings, so a rename breaks this audit loudly instead of silently dropping the static set.
const STATIC_MARKERS = {
  pole: '        addSignalPole(p, site.timing);',
  refuge: '    addSignalPole(refugePole, dworzec.timing);',
  head: '          signalArmPoles.get(a).hasHead = true;\n          vehicleHeadSites.push({ site, a, p, group0 });',
  ped: '    const x = p.x + fx * 0.17, z = p.z + fz * 0.17;'
};
function instrumentStatic(src) {
  for (const [name, marker] of Object.entries(STATIC_MARKERS)) {
    if (!src.includes(marker)) throw new Error(`static signal marker "${name}" not found in street-details.js`);
  }
  return src
    .replace(STATIC_MARKERS.pole,
      `${STATIC_MARKERS.pole} capture({ source: 'static', kind: 'pole', x: p.x, z: p.z, side, ` +
      `arm: a.name, junction: site.junction, junctionX: site.x, junctionZ: site.z, timing: site.timing });`)
    .replace(STATIC_MARKERS.refuge,
      `${STATIC_MARKERS.refuge} capture({ source: 'static', kind: 'pole', x: refugePole.x, z: refugePole.z, ` +
      `side: 0, arm: 'Dworzec refuge', junction: dworzec.junction, junctionX: dworzec.x, junctionZ: dworzec.z, ` +
      `timing: dworzec.timing });`)
    .replace(STATIC_MARKERS.head, `${STATIC_MARKERS.head}\n          capture({ source: 'static', kind: 'head', ` +
      `x: p.x + a.ux * 0.18, z: p.z + a.uz * 0.18, angle: Math.atan2(a.ux, a.uz), big, side, ` +
      `arm: a.name, junction: site.junction, junctionX: site.x, junctionZ: site.z, timing: site.timing });`)
    .replace(STATIC_MARKERS.ped,
      `${STATIC_MARKERS.ped} capture({ source: 'static', kind: 'pedHead', x, z, angle: Math.atan2(fx, fz), timing });`);
}

// Same landmark, building and bridge collider fixture the tree and span audits build.
const { runAudit } = await import('./audit-tree-clearance.mjs');
const savedLog = console.log;
console.log = () => {};
const streetSource = instrumentStatic(before
  ? (await import('node:child_process')).execFileSync('git', ['show', 'HEAD:js/street-details.js'],
    { encoding: 'utf8' })
  : source('street-details'));
const captured = [];
const world = await runAudit({ worldOnly: true, streetSource, capture: (record) => captured.push(record) });
console.log = savedLog;
const { config, details: street, grid, gridModule, roadMod: road, tramMod: tramInfra } = world;
const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints,
  ...world.buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
  imports: { './road-network.js': road }, globals: { console: { info() {}, warn() {}, log() {} } }
});
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
const tramLayout = tramInfra.layoutTramInfrastructure(network, grid);
const railLayout = tramInfra.layoutRailInfrastructure(network);
const supports = [...tramLayout.poles, ...railLayout.masts];
const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
vm.runInNewContext(`(${configure})`, { nodes: network.nodes, pedRoutes, KERB: 1.6, signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal,
  configureSignalClearance: config.configureSignalClearance })();
street.addRuntimeSignalHeads(network);
street.addRuntimeSignalHeads(network, pedRoutes, supports, railLayout);

// --- Balcony slab+railing volumes (js/balconies.js, near and far proxies share this footprint) ---------------
// Local frame: slab top y 0, railing top y 1.0, slab soffit y -0.14, depth z -0.55 (wall) .. 0.45 (street).
// The record's ry is the block frame and `facing` the front; balconies.js rotates by ry + facing about the record.
const SLAB = 0.14;
const RAIL = 1.0;
const BACK = -0.55;
const FRONT = 0.45;
const WIDTH = 2.4;
const volumes = [];
for (const blk of world.blocks) {
  for (const b of blk.balconies) {
    const angle = (b.ry || 0) + b.facing;
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const w = b.w ? Math.min(3, Math.max(1.5, b.w)) : WIDTH;
    const hw = w / 2, hz = (FRONT - BACK) / 2, zc = (FRONT + BACK) / 2;
    for (let i = 0; i < b.landings; i++) {
      const base = b.y + i * b.storey;
      volumes.push({ blk: blk.srcBlockId ?? blk.id, detail: blk.id, stack: b, landing: i,
        x: b.x, z: b.z, cs, sn, hw, hz, zc, y0: base - SLAB, y1: base + RAIL });
    }
  }
}

// Point-to-oriented-box distance. The balcony box is axis aligned in its own frame (turned about y).
function pointBoxGap2(px, py, pz, v) {
  const dx = px - v.x, dz = pz - v.z;
  const lx = v.cs * dx - v.sn * dz;
  const lz = v.sn * dx + v.cs * dz;
  const ex = Math.max(Math.abs(lx) - v.hw, 0);
  const ey = Math.max(v.y0 - py, 0, py - v.y1);
  const ez = Math.max(Math.abs(lz - v.zc) - v.hz, 0);
  return ex * ex + ey * ey + ez * ez;
}
// Exact segment-to-box distance: the squared distance to a convex box is convex along a line, so a ternary search
// on t converges to the closest point.
function segmentBoxGap(ax, ay, az, bx, by, bz, v) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    const d1 = pointBoxGap2(ax + (bx - ax) * m1, ay + (by - ay) * m1, az + (bz - az) * m1, v);
    const d2 = pointBoxGap2(ax + (bx - ax) * m2, ay + (by - ay) * m2, az + (bz - az) * m2, v);
    if (d1 <= d2) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2;
  return Math.sqrt(pointBoxGap2(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, v));
}

// --- Raised signal elements ---------------------------------------------------------------------------------
// Heights and sizes from js/street-details.js: S-1 centre 3.55 m on a 4.2 m pole; overhead arm 5.55 m, head 5.3 m
// on a 6.2 m mast (or a sleeve from 4.1 m); bridge head 5.15 m under the fascia arm; span stay top 10 m (7.2 m on
// traction poles) and a vertical drop to 5.35 m. S-1 housing 0.3 x 0.86 x 0.22 with a bracket to z -0.30 and
// visors to +0.27; a 0.54 x 1.1 backplate on big heads (same check as the renderer: w >= 14.5 or lanes >= 3).
const S1_Y = 3.55;
const OVERHEAD_Y = 5.3;
const OVERHEAD_ARM_Y = 5.55;
const OVERHEAD_MAST_H = 6.2;
const SPAN_WIRE_R = 0.018;
const ARM_R = 0.045;
const SIGNAL_POLE_H = 4.2;
const POLE_R = 0.1; // Footprint/collider radius; the rendered shaft is 0.055 m.
const PED = { hx: 0.15, hy: 0.3, z0: -0.27, z1: 0.22 };
const elements = [];
const pushSegment = (cls, kind, label, a, b, r) => elements.push({ cls, kind, label, a, b, r });
const pushHead = (cls, kind, label, x, y, z, angle, big, ped = false) => {
  if (ped) elements.push({ cls, kind, label, x, y, z, angle, hx: PED.hx, hy: PED.hy,
    zc: (PED.z0 + PED.z1) / 2, hz: (PED.z1 - PED.z0) / 2 });
  else elements.push({ cls, kind, label, x, y, z, angle, hx: big ? 0.27 : 0.15, hy: big ? 0.55 : 0.43,
    zc: (-0.3 + 0.27) / 2, hz: (0.27 + 0.3) / 2 });
};
const headSpot = (h, along) => ({ x: h.p.x + h.a.ux * along, z: h.p.z + h.a.uz * along,
  angle: Math.atan2(h.a.ux, h.a.uz) });
const bigHead = (h) => h.a.w >= 14.5 || h.a.lanes >= 3;
const edgeOf = (h) => h.edge.id;

const spans = street.runtimeHeads.filter((h) => h.span);
spans.forEach((h, span) => {
  const start = elements.length;
  const [a, b] = h.anchors, p = h.p, topY = h.topY ?? 10;
  const id = `span edge ${edgeOf(h)}`;
  pushSegment('span', 'stay', `${id} stay anchor 0`, [a.x, topY, a.z], [p.x, topY, p.z], SPAN_WIRE_R);
  pushSegment('span', 'stay', `${id} stay anchor 1`, [b.x, topY, b.z], [p.x, topY, p.z], SPAN_WIRE_R);
  pushSegment('span', 'drop', `${id} drop`, [p.x, topY, p.z], [p.x, 5.35, p.z], SPAN_WIRE_R);
  const spot = headSpot(h, 0.18);
  pushHead('span', 'head', `${id} head`, spot.x, OVERHEAD_Y, spot.z, spot.angle, bigHead(h));
  h.anchors.forEach((anchor, j) => {
    const traction = !!h.anchorTraction?.[j];
    // New/reused signal mast collider is a 0.1 m radius; a traction pole tapers 0.15 -> 0.1 m (tram-infra.js).
    pushSegment('span', 'mast', `${id} mast anchor ${j}`, [anchor.x, 0.1, anchor.z], [anchor.x, topY, anchor.z],
      traction ? 0.15 : 0.1);
  });
  for (let i = start; i < elements.length; i++) elements[i].group = span;
});

for (const h of street.runtimeHeads) {
  if (h.span) continue;
  if (h.bridge) {
    // addRod(anchor -> end at topY), addRod(end -> headY + 0.55), head at headY.
    const id = `bridge edge ${edgeOf(h)}`, topY = h.topY, headY = h.headY ?? 5.15, p = h.p, a = h.pole;
    pushSegment('bridge', 'arm', `${id} fascia arm`, [a.x, topY, a.z], [p.x, topY, p.z], ARM_R);
    pushSegment('bridge', 'drop', `${id} drop`, [p.x, topY, p.z], [p.x, headY + 0.55, p.z], ARM_R);
    const spot = headSpot(h, 0.18);
    pushHead('bridge', 'head', `${id} head`, spot.x, headY, spot.z, spot.angle, bigHead(h));
  } else if (h.overhead) {
    // addOverheadPole(6.2 m) or addMastExtension(6.2 m) on the existing pole, then addSignalArm at 5.55 m.
    const id = `cantilever edge ${edgeOf(h)}`, foot = h.pole;
    pushSegment('cantilever', 'mast', `${id} mast`, [foot.x, 0.1, foot.z], [foot.x, 0.1 + OVERHEAD_MAST_H, foot.z], POLE_R);
    pushSegment('cantilever', 'arm', `${id} arm`, [foot.x, OVERHEAD_ARM_Y, foot.z],
      [h.p.x, OVERHEAD_ARM_Y, h.p.z], ARM_R);
    const spot = headSpot(h, 0.18);
    pushHead('cantilever', 'head', `${id} head`, spot.x, OVERHEAD_Y, spot.z, spot.angle, bigHead(h));
  } else {
    // A ground head: addSignalPole(4.2 m) when no existing pole was reused; the S-1 centre is at 3.55 m.
    const id = `ground edge ${edgeOf(h)}`;
    pushSegment('ground', 'pole', `${id} pole`, [h.p.x, 0.1, h.p.z], [h.p.x, 0.1 + SIGNAL_POLE_H, h.p.z], POLE_R);
    const spot = headSpot(h, 0.18);
    pushHead('ground', 'head', `${id} head`, spot.x, S1_Y, spot.z, spot.angle, bigHead(h));
  }
}

// Static boot-time geometry. The rendered scene drops the poles/heads of plans that route pruning disabled, so the
// captured records are filtered through the shared plan alias before they count.
let staticDisabled = 0;
const siteName = (r) => r.junction !== undefined
  ? ` (junction ${r.junction}, ${r.arm || 'unnamed arm'}, side ${r.side})` : '';
for (const r of captured) {
  if (r.source !== 'static') continue;
  let plan = r.timing;
  while (plan && plan.alias) plan = plan.alias;
  if (plan?.disabled) { staticDisabled++; continue; }
  if (r.kind === 'pole') {
    pushSegment('static', 'pole', `pole${siteName(r)} (${r.x.toFixed(3)}, ${r.z.toFixed(3)})`,
      [r.x, 0.1, r.z], [r.x, 0.1 + SIGNAL_POLE_H, r.z], POLE_R);
  } else if (r.kind === 'head') {
    pushHead('static', 'head', `head${siteName(r)} (${r.x.toFixed(3)}, ${r.z.toFixed(3)})`,
      r.x, S1_Y, r.z, r.angle, r.big);
  } else if (r.kind === 'pedHead') {
    pushHead('static', 'pedHead', `pedestrian head (${r.x.toFixed(3)}, ${r.z.toFixed(3)})`,
      r.x, 2.45, r.z, r.angle, false, true);
  }
  if (r.junction !== undefined) {
    elements[elements.length - 1].site = { junction: r.junction, arm: r.arm, side: r.side,
      x: r.junctionX, z: r.junctionZ };
  }
}

// 16 m bucket grid over the balcony volumes, bbox expanded by the clearance margin.
const CELL = 16;
const volumeCells = new Map();
const cellKey = (ix, iz) => ix * 100000 + iz;
for (let i = 0; i < volumes.length; i++) {
  const v = volumes[i];
  const ex = v.hw * Math.abs(v.cs) + v.hz * Math.abs(v.sn);
  const ez = v.hw * Math.abs(v.sn) + v.hz * Math.abs(v.cs);
  const x0 = Math.floor((v.x - ex - MARGIN) / CELL), x1 = Math.floor((v.x + ex + MARGIN) / CELL);
  const z0 = Math.floor((v.z - ez - MARGIN) / CELL), z1 = Math.floor((v.z + ez + MARGIN) / CELL);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const k = cellKey(ix, iz);
    const list = volumeCells.get(k);
    if (list) list.push(i); else volumeCells.set(k, [i]);
  }
}

const hits = new Map();
const nearest = {};
const nearestClass = {};
const addHit = (ei, vi, gap) => {
  const e = elements[ei];
  const n = nearest[e.kind];
  if (!n || gap < n.gap) nearest[e.kind] = { gap, element: ei, volume: vi };
  const c = nearestClass[e.cls];
  if (!c || gap < c.gap) nearestClass[e.cls] = { gap, element: ei, volume: vi };
  if (gap >= MARGIN) return;
  const k = `${ei}:${vi}`;
  const row = { element: e, volume: volumes[vi], gap: Math.round(gap * 1000) / 1000,
    overlap: Math.round((MARGIN - gap) * 1000) / 1000 };
  const old = hits.get(k);
  if (!old || row.gap < old.gap) hits.set(k, row);
};
const headCorners = (e) => {
  const cs = Math.cos(e.angle), sn = Math.sin(e.angle);
  const pts = [];
  for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
    [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
    const lx = sx * e.hx, lz = e.zc + sz * e.hz;
    pts.push([e.x + cs * lx + sn * lz, e.y + sy * e.hy, e.z - sn * lx + cs * lz]);
  }
  return pts;
};
// A head is a small convex box: sample its 12 edges every 2 cm; the two boxes' minimum is then within a centimetre
// of the sampled minimum, well inside the reported 0.001 m.
const headEdgePoints = (e) => {
  const c = headCorners(e);
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const out = [];
  for (const [i, j] of edges) {
    const len = Math.hypot(c[j][0] - c[i][0], c[j][1] - c[i][1], c[j][2] - c[i][2]);
    const steps = Math.max(1, Math.ceil(len / 0.02));
    for (let s = 0; s <= steps; s++) out.push([
      c[i][0] + (c[j][0] - c[i][0]) * s / steps,
      c[i][1] + (c[j][1] - c[i][1]) * s / steps,
      c[i][2] + (c[j][2] - c[i][2]) * s / steps]);
  }
  return out;
};

for (let ei = 0; ei < elements.length; ei++) {
  const e = elements[ei];
  const isHead = e.kind === 'head' || e.kind === 'pedHead';
  const pts = isHead ? headEdgePoints(e) : null;
  const xs = isHead ? pts.map((p) => p[0]) : [e.a[0], e.b[0]];
  const zs = isHead ? pts.map((p) => p[2]) : [e.a[2], e.b[2]];
  const yLo = isHead ? e.y - e.hy : Math.min(e.a[1], e.b[1]);
  const yHi = isHead ? e.y + e.hy : Math.max(e.a[1], e.b[1]);
  const r = isHead ? 0 : e.r;
  const x0 = Math.floor((Math.min(...xs) - r - NEAR) / CELL);
  const x1 = Math.floor((Math.max(...xs) + r + NEAR) / CELL);
  const z0 = Math.floor((Math.min(...zs) - r - NEAR) / CELL);
  const z1 = Math.floor((Math.max(...zs) + r + NEAR) / CELL);
  const seen = new Set();
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const list = volumeCells.get(cellKey(ix, iz));
    if (!list) continue;
    for (const vi of list) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const v = volumes[vi];
      if (v.y1 + NEAR <= yLo || v.y0 - NEAR >= yHi) continue;
      let gap;
      if (isHead) {
        gap = Infinity;
        for (const p of pts) gap = Math.min(gap, Math.sqrt(pointBoxGap2(p[0], p[1], p[2], v)));
      } else {
        gap = segmentBoxGap(e.a[0], e.a[1], e.a[2], e.b[0], e.b[1], e.b[2], v) - r;
      }
      addHit(ei, vi, gap);
    }
  }
}

// --- Report ------------------------------------------------------------------------------------------------
// Self-check: each balcony's wall face (local z = BACK) must sit on a building collider face; a wrong turn or a
// missing placeInFrame transform would show up as a systematic offset.
if (process.argv.includes('--self-check')) {
  const dist = (px, pz) => {
    let best = Infinity;
    for (const c of world.buildingColliders) {
      const dx = Math.max(c.minX - px, 0, px - c.maxX);
      const dz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  };
  const sample = [];
  let insideFront = 0, checkedFront = 0;
  const inside = (c, px, pz) => px >= c.minX && px <= c.maxX && pz >= c.minZ && pz <= c.maxZ;
  const axisColliders = world.buildingColliders.filter((c) => !c.obb);
  for (let i = 0; i < volumes.length; i += Math.max(1, Math.floor(volumes.length / 2000))) {
    const v = volumes[i];
    // Local z -0.54 (just inside the wall face) at mid width, first-landing height.
    const lx = 0, lz = BACK + 0.01;
    const px = v.x + v.cs * lx + v.sn * lz, pz = v.z - v.sn * lx + v.cs * lz;
    sample.push(dist(px, pz));
    // Local z +0.45 is the slab front, 1.0 m off the wall. On an axis-aligned host (its collider is its real footprint)
    // it must stand outside that host, which verifies the overhang direction rather than only the wall plane.
    const fx = v.x + v.sn * FRONT, fz = v.z + v.cs * FRONT;
    let host = null, best = Infinity;
    for (const c of axisColliders) {
      const d = Math.hypot(Math.max(c.minX - px, 0, px - c.maxX), Math.max(c.minZ - pz, 0, pz - c.maxZ));
      if (d < best) { best = d; host = c; }
    }
    if (host && best < 0.02) {
      checkedFront++;
      if (inside(host, fx, fz)) insideFront++;
    }
  }
  sample.sort((a, b) => a - b);
  console.log(JSON.stringify({ selfCheck: { sampled: sample.length, min: sample[0],
    median: sample[Math.floor(sample.length / 2)], max: sample[sample.length - 1],
    over1m: sample.filter((d) => d > 1).length, checkedFront, insideFront } }));
}
const rows = [...hits.values()].sort((a, b) => b.overlap - a.overlap);
const spanSet = new Set(rows.filter((r) => r.element.group !== undefined).map((r) => r.element.group));
const byKind = {};
for (const r of rows) byKind[r.element.kind] = (byKind[r.element.kind] || 0) + 1;
const byClass = {};
for (const e of elements) byClass[e.cls] = (byClass[e.cls] || 0) + 1;
const classesHit = new Set(rows.map((r) => r.element.cls));
const countOf = (cls, kind) => elements.filter((e) => e.cls === cls && e.kind === kind).length;
// Diagnostic context for reported rows: distance from the element's centre (or segment midpoint) to the nearest
// building collider AABB, horizontally. AABB distances overstate turned facades, matching the placement checks.
const nearestBuilding = (e) => {
  const px = e.kind === 'head' || e.kind === 'pedHead' ? e.x : (e.a[0] + e.b[0]) / 2;
  const pz = e.kind === 'head' || e.kind === 'pedHead' ? e.z : (e.a[2] + e.b[2]) / 2;
  let best = Infinity;
  for (const c of world.buildingColliders) {
    const dx = Math.max(c.minX - px, 0, px - c.maxX);
    const dz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return Math.round(best * 1000) / 1000;
};
// Exact horizontal distance to an oriented collider (turned buildings carry their real frame in `obb`); a plain AABB
// is already the footprint. This context distinguishes a real narrow sidewalk from the conservative world AABB.
const nearestCollider = (e) => {
  const px = e.kind === 'head' || e.kind === 'pedHead' ? e.x : (e.a[0] + e.b[0]) / 2;
  const pz = e.kind === 'head' || e.kind === 'pedHead' ? e.z : (e.a[2] + e.b[2]) / 2;
  let row = null;
  for (const c of world.buildingColliders) {
    let d;
    if (c.obb) {
      const dx = px - c.obb.cx, dz = pz - c.obb.cz;
      const lx = c.obb.cs * dx - c.obb.sn * dz, lz = c.obb.sn * dx + c.obb.cs * dz;
      d = Math.hypot(Math.max(Math.abs(lx) - c.obb.hx, 0), Math.max(Math.abs(lz) - c.obb.hz, 0));
    } else {
      d = Math.hypot(Math.max(c.minX - px, 0, px - c.maxX), Math.max(c.minZ - pz, 0, pz - c.maxZ));
    }
    if (!row || d < row.distance) row = { distance: Math.round(d * 1000) / 1000, kind: c.kind ?? null,
      isLandmark: !!c.isLandmark, minY: c.minY, maxY: c.maxY, obb: !!c.obb };
  }
  return row;
};
const rowText = (r) => {
  const e = r.element, v = r.volume, b = v.stack;
  const where = e.kind === 'head' || e.kind === 'pedHead'
    ? `${e.label} at (${e.x.toFixed(3)}, ${e.z.toFixed(3)}) y ${(e.y - e.hy).toFixed(2)}..${(e.y + e.hy).toFixed(2)}`
    : `${e.label} (${e.a[0].toFixed(3)}, ${e.a[2].toFixed(3)}) -> (${e.b[0].toFixed(3)}, ${e.b[2].toFixed(3)}) ` +
      `y ${Math.min(e.a[1], e.b[1]).toFixed(2)}..${Math.max(e.a[1], e.b[1]).toFixed(2)}`;
  return `${r.overlap.toFixed(3)} m over the ${MARGIN} m margin (gap ${r.gap.toFixed(3)}): ${e.cls} ${where}; ` +
    `balcony block ${v.blk} (${v.detail}) stack (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) landing ${v.landing} ` +
    `y ${v.y0.toFixed(2)}..${v.y1.toFixed(2)} ry ${(b.ry || 0).toFixed(3)} facing ${b.facing.toFixed(3)}`;
};
const nearestRow = (n) => {
  const e = elements[n.element], v = volumes[n.volume];
  const element = (e.kind === 'head' || e.kind === 'pedHead')
    ? { x: e.x, y: e.y, z: e.z, label: e.label }
    : { ax: e.a[0], az: e.a[2], bx: e.b[0], bz: e.b[2],
      y0: Math.min(e.a[1], e.b[1]), y1: Math.max(e.a[1], e.b[1]), label: e.label };
  return { gap: Math.round(n.gap * 1000) / 1000, class: e.cls, element, block: v.blk,
    stack: { x: v.stack.x, y: v.stack.y, z: v.stack.z }, landing: v.landing };
};
const summary = {
  margin: MARGIN,
  nearQuery: NEAR,
  spans: spans.length,
  runtimeHeads: street.runtimeHeads.length,
  elements: elements.length,
  byClass,
  heads: {
    span: countOf('span', 'head'),
    cantilever: countOf('cantilever', 'head'),
    ground: countOf('ground', 'head'),
    bridge: countOf('bridge', 'head'),
    static: countOf('static', 'head'),
    staticPedestrian: countOf('static', 'pedHead')
  },
  staticPoles: countOf('static', 'pole'),
  groundPoles: countOf('ground', 'pole'),
  masts: countOf('cantilever', 'mast') + countOf('span', 'mast'),
  staticCaptured: captured.length,
  staticDisabled,  balconyStacks: world.blocks.reduce((n, blk) => n + blk.balconies.length, 0),
  balconyVolumes: volumes.length,
  rows: rows.length,
  intersectingSpans: spanSet.size,
  classesHit: [...classesHit],
  intersectingBalconyVolumes: new Set(rows.map((r) => r.volume)).size,
  byKind,
  anchors: {
    newMasts: spans.reduce((n, h) => n + h.anchorExisting.filter((e) => !e).length, 0),
    reusedPoles: spans.reduce((n, h) => n + h.anchorExisting.filter(Boolean).length, 0),
    traction: spans.reduce((n, h) => n + h.anchorTraction.filter(Boolean).length, 0),
    topY: [...new Set(spans.map((h) => h.topY ?? 10))].sort((a, b) => a - b)
  },
  nearest: Object.fromEntries(Object.entries(nearest).map(([kind, n]) => [kind, nearestRow(n)])),
  classNearest: Object.fromEntries(Object.keys(byClass).map((cls) => [cls, nearestClass[cls]
    ? nearestRow(nearestClass[cls]) : { gap: null, note: `no volume within the ${NEAR} m query` }])),
  worst: rows.slice(0, TOP).map((r) => ({
    class: r.element.cls, kind: r.element.kind, label: r.element.label,
    site: r.element.site ?? null, nearestBuilding: nearestBuilding(r.element),
    nearestCollider: nearestCollider(r.element),
    element: (r.element.kind === 'head' || r.element.kind === 'pedHead')
      ? { x: r.element.x, y: r.element.y, z: r.element.z }
      : { ax: r.element.a[0], az: r.element.a[2], bx: r.element.b[0], bz: r.element.b[2],
        y0: Math.min(r.element.a[1], r.element.b[1]), y1: Math.max(r.element.a[1], r.element.b[1]) },
    block: r.volume.blk, detail: r.volume.detail,
    stack: { x: r.volume.stack.x, y: r.volume.stack.y, z: r.volume.stack.z, storey: r.volume.stack.storey,
      landings: r.volume.stack.landings, w: r.volume.stack.w, ry: r.volume.stack.ry, facing: r.volume.stack.facing },
    landing: r.volume.landing, y0: r.volume.y0, y1: r.volume.y1, gap: r.gap, overlap: r.overlap,
    text: rowText(r)
  }))
};
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows: rows.map((r) => rowText(r)) }));
} else {
  for (const row of summary.worst) console.log(row.text);
  console.log(JSON.stringify(summary));
}
