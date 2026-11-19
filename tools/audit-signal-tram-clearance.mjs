// Headless geometric audit of all signal poles, overhead masts, cantilevers, heads, stays,
// and Górna Wilda traction-pole span against the articulated tram swept envelope and catenary wires.
// Reuses the headless build from tools/audit-signal-heads.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

const config = await import('../js/city-config.js');
const { GEO } = await import('../js/geodata.js');
const rendering = {
  'three/webgpu': inert(),
  'three/tsl': inert(),
  'three/addons/utils/BufferGeometryUtils.js': inert(),
  './tsl-materials.js': inert()
};
const globals = { document: inert(), console: { info() {}, warn() {}, log() {} } };

const road = loadModule(source('road-network'), {
  imports: { './city-config.js': config, './geodata.js': { GEO } },
  globals
});
const gridModule = loadModule(
  source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
  { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
);
const grid = gridModule.buildCityGrid(inert());
const liveGrid = { ...gridModule, ...grid, ...gridModule.snapshot() };

// Instrument street-details.js in memory to record every placed signal pole, mast, arm, stay, and head.
const audit = {
  ordinaryPoles: [],
  ordinaryHeads: [],
  pedHeads: [],
  overheadPoles: [],
  mastExtensions: [],
  cantileverArms: [],
  spanWires: [],
  signalArmPoles: null,
  vehicleHeadSites: null
};

let streetSource = source('street-details');
streetSource = streetSource.replace(
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {',
  '  Object.assign(audit, { signalArmPoles, vehicleHeadSites });\n' +
  '  function addRuntimeSignalHeads(network, pedRoutes = null, supports = null, railLayout = null) {'
);
streetSource = streetSource.replace(
  '  const signalHeadMatrix = (p, a) => setFacing(p.x + a.ux * 0.18, S1_Y, p.z + a.uz * 0.18, a.ux, a.uz);',
  '  const signalHeadMatrix = (p, a) => {\n' +
  '    audit.ordinaryHeads.push({ p: { x: p.x, z: p.z }, a: { ux: a.ux, uz: a.uz, w: a.w, lanes: a.lanes } });\n' +
  '    return setFacing(p.x + a.ux * 0.18, S1_Y, p.z + a.uz * 0.18, a.ux, a.uz);\n' +
  '  };'
);
streetSource = streetSource.replace(
  '  function addSignalPole(p) {',
  '  function addSignalPole(p) {\n    audit.ordinaryPoles.push({ x: p.x, z: p.z, r: 0.055, colliderR: 0.08, h: SIGNAL_POLE_H });'
);
streetSource = streetSource.replace(
  '  function addOverheadPole(p, height = OVERHEAD_MAST_H) {',
  '  function addOverheadPole(p, height = OVERHEAD_MAST_H) {\n    audit.overheadPoles.push({ x: p.x, z: p.z, r: 0.08, colliderR: 0.1, h: height });'
);
streetSource = streetSource.replace(
  '  function addMastExtension(p, height = OVERHEAD_MAST_H) {',
  '  function addMastExtension(p, height = OVERHEAD_MAST_H) {\n    audit.mastExtensions.push({ x: p.x, z: p.z, r: 0.06, h: height });'
);
streetSource = streetSource.replace(
  '  function addSignalArm(p, head) {',
  '  function addSignalArm(p, head) {\n    audit.cantileverArms.push({ from: { x: p.x, z: p.z }, to: { x: head.x, z: head.z }, y: OVERHEAD_ARM_Y, r: OVERHEAD_ARM_R });'
);
streetSource = streetSource.replace(
  '  function addSpanWires(a, b, head, topY = SPAN_Y) {',
  '  function addSpanWires(a, b, head, topY = SPAN_Y) {\n    audit.spanWires.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, head: { x: head.x, z: head.z }, topY, r: SPAN_WIRE_R });'
);
streetSource = streetSource.replace(
  '  function addPedestrianHead(p, fx, fz, isAvenue, timing) {',
  '  function addPedestrianHead(p, fx, fz, isAvenue, timing) {\n    audit.pedHeads.push({ p: { x: p.x, z: p.z }, fx, fz });'
);

const street = loadModule(streetSource, {
  imports: {
    ...rendering,
    './city-config.js': config,
    './road-network.js': road,
    './city-grid.js': liveGrid,
    './satellite-sites.js': await import('../js/satellite-sites.js'),
    './trees.js': { createTreeField: () => ({ group: inert() }) }
  },
  globals: { ...globals, audit }
}).buildStreetDetails(inert());

const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints]);
const { createPedestrianRoutes } = loadModule(source('pedestrian-routes'), {
  imports: { './road-network.js': road },
  globals
});
const pedRoutes = createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);

const tramInfra = loadModule(source('tram-infra'), {
  imports: { ...rendering, './geodata.js': { GEO }, './city-config.js': config },
  globals
});
const tramLayout = tramInfra.layoutTramInfrastructure(network, grid);
const railLayout = tramInfra.layoutRailInfrastructure(network);
const supports = [...tramLayout.poles, ...railLayout.masts];

const configure = source('traffic').match(/  function configureSignals\([^]*?\n  \}/)[0];
vm.runInNewContext(`(${configure})`, {
  nodes: network.nodes,
  pedRoutes,
  KERB: 1.6,
  signalNodes: [],
  configurePedestrianSignal: config.configurePedestrianSignal,
  configureSignalClearance: config.configureSignalClearance
})();

street.addRuntimeSignalHeads(network);
street.addRuntimeSignalHeads(network, pedRoutes, supports, railLayout);

// Load trams.js for exact track graph, TRAM_MODELS, TRAM_HALF_WIDTH, edgePoint, poseSections.
const tramsModule = loadModule(source('trams'), {
  imports: {
    'three/webgpu': inert(),
    './geodata.js': { GEO },
    './city-config.js': config,
    './tsl-materials.js': inert(),
    './actor-models.js': inert(),
    './vehicle-lights.js': inert()
  },
  globals
});

const { TRAM_MODELS, TRAM_HALF_WIDTH, buildTrackGraph, edgePoint, poseSections } = tramsModule;

// Constants from js/actor-models.js & js/tram-infra.js & js/street-details.js
const TRAM_ROOF = 3.18; // js/actor-models.js:3481
const TRAM_FAIRING_TOP = 3.37; // TRAM_ROOF + 0.12 + 0.07 (js/actor-models.js:3542)
const TRAM_PANTOGRAPH_HEAD = 5.77; // js/actor-models.js:3485
const TRAM_PANTOGRAPH_TOP = 5.795; // TRAM_PANTOGRAPH_HEAD + 0.05/2 (js/actor-models.js:3520)
const TRAM_MIRROR_HALF_W = 1.425; // side * 1.4 + 0.05/2 at y = 2.5 m (js/actor-models.js:3551)
const TRAM_WIRE_Y = 5.8; // js/tram-infra.js:30
const TRAM_SPAN_Y = 6.6; // js/tram-infra.js:31 (rendered span at 6.75, arm at 6.6, stay top at 7.5)
const OVERHEAD_Y = 5.3;
const S1_Y = 3.55;

// Build tram track graph and swept envelope across ALL tram edges (both curved chords and straight tracks).
const graph = buildTrackGraph(GEO.rail || []);
const uniqueLengths = [...new Set(Object.values(TRAM_MODELS).flatMap((m) => m.sections.map((s) => s.len)))];

// 1) Spatial grid of all tram track segments (from GEO.rail kind 'tram')
const CELL = 16;
const segGrid = new Map();
const addSegToGrid = (gridMap, ax, az, bx, bz, data, pad = 4) => {
  const x0 = Math.min(ax, bx) - pad, x1 = Math.max(ax, bx) + pad;
  const z0 = Math.min(az, bz) - pad, z1 = Math.max(az, bz) + pad;
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
    for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
      const k = `${ix},${iz}`;
      let arr = gridMap.get(k);
      if (!arr) { arr = []; gridMap.set(k, arr); }
      arr.push(data);
    }
  }
};

const tramTracks = GEO.rail.filter((r) => r.kind === 'tram' && r.pts.length >= 4);
for (let ti = 0; ti < tramTracks.length; ti++) {
  const pts = tramTracks[ti].pts;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    addSegToGrid(segGrid, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], {
      ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3], street: tramTracks[ti].street || ''
    }, 6);
  }
}

// 2) Spatial grid of all curved section chord rectangles (including switch continuations)
const rectGrid = new Map();
const out = [{}], rear = {}, front = {}, middle = {};
let curvedRectCount = 0;

function visitEnds(edge, s, path, starts, visit) {
  if (s <= edge.len || !edge.next.length) {
    edgePoint(edge, s, front);
    visit(path, starts);
    return;
  }
  for (const next of edge.next) {
    if (path.includes(next)) continue;
    visitEnds(next, s - edge.len, [...path, next], [...starts, starts.at(-1) + edge.len], visit);
  }
}

for (const edge of graph.edges) {
  for (const len of uniqueLengths) {
    const model = { sections: [{ len }], gap: 0 };
    for (let s = 0; s < edge.len; s += 0.5) {
      edgePoint(edge, s, rear);
      visitEnds(edge, s + len, [edge], [0], (path, starts) => {
        const ux = front.x - rear.x, uz = front.z - rear.z;
        const d = Math.hypot(ux, uz);
        if (!d) return;
        const trackPath = {
          pointAt(u, p) {
            let k = starts.length - 1;
            while (k > 0 && starts[k] > u) k--;
            return edgePoint(path[k], u - starts[k], p);
          }
        };
        trackPath.pointAt(s + len / 2, middle);
        let curved = Math.abs(ux * rear.tz - uz * rear.tx) / d > 1e-6 ||
          Math.abs(ux * front.tz - uz * front.tx) / d > 1e-6 ||
          Math.abs(ux * (middle.z - rear.z) - uz * (middle.x - rear.x)) / d > 1e-6;
        for (let i = 0; !curved && i < path.length; i++) {
          const e = path[i], start = s - starts[i], end = s + len - starts[i];
          let lo = 0, hi = e.cum.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (e.cum[mid] <= start) lo = mid + 1;
            else hi = mid;
          }
          for (let k = lo; k < e.cum.length && e.cum[k] < end; k++) {
            if (Math.abs(ux * (e.pts[2 * k + 1] - rear.z) - uz * (e.pts[2 * k] - rear.x)) / d > 1e-6) {
              curved = true;
              break;
            }
          }
        }
        if (!curved) return;
        poseSections(trackPath, s + len, model, out);
        const r = {
          x: out[0].x, z: out[0].z, heading: out[0].heading,
          halfLength: out[0].halfLength, halfWidth: out[0].halfWidth,
          ux: Math.sin(out[0].heading), uz: Math.cos(out[0].heading),
          rx: Math.cos(out[0].heading), rz: -Math.sin(out[0].heading),
          len, street: edge.street || ''
        };
        const hx = Math.abs(r.ux) * r.halfLength + Math.abs(r.rx) * r.halfWidth;
        const hz = Math.abs(r.uz) * r.halfLength + Math.abs(r.rz) * r.halfWidth;
        for (let ix = Math.floor((r.x - hx) / CELL); ix <= Math.floor((r.x + hx) / CELL); ix++) {
          for (let iz = Math.floor((r.z - hz) / CELL); iz <= Math.floor((r.z + hz) / CELL); iz++) {
            const k = `${ix},${iz}`;
            let arr = rectGrid.get(k);
            if (!arr) { arr = []; rectGrid.set(k, arr); }
            arr.push(r);
          }
        }
        curvedRectCount++;
      });
    }
  }
}

function pointSegDist2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  if (l2 === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function signedRectDist(px, pz, r) {
  const dx = px - r.x, dz = pz - r.z;
  const lz = dx * r.ux + dz * r.uz;
  const lx = dx * r.rx + dz * r.rz;
  const qx = Math.abs(lx) - r.halfWidth;
  const qz = Math.abs(lz) - r.halfLength;
  if (qx <= 0 && qz <= 0) return Math.max(qx, qz); // negative penetration depth
  return Math.hypot(Math.max(0, qx), Math.max(0, qz));
}

// Signed lateral clearance of point (px, pz) from the tram swept envelope (negative = inside envelope).
function sweepClearance(px, pz) {
  let minTrackDist = Infinity;
  let minRectDist = Infinity;
  let nearestStreet = '';
  const ix0 = Math.floor(px / CELL), iz0 = Math.floor(pz / CELL);
  for (let ix = ix0 - 1; ix <= ix0 + 1; ix++) {
    for (let iz = iz0 - 1; iz <= iz0 + 1; iz++) {
      const k = `${ix},${iz}`;
      const segs = segGrid.get(k);
      if (segs) {
        for (const s of segs) {
          const d = pointSegDist2D(px, pz, s.ax, s.az, s.bx, s.bz);
          if (d < minTrackDist) { minTrackDist = d; nearestStreet = s.street; }
        }
      }
      const rects = rectGrid.get(k);
      if (rects) {
        for (const r of rects) {
          const d = signedRectDist(px, pz, r);
          if (d < minRectDist) minRectDist = d;
        }
      }
    }
  }
  const trackClear = minTrackDist - TRAM_HALF_WIDTH;
  const clearance = Math.min(trackClear, minRectDist);
  return {
    clearance,
    trackDist: minTrackDist,
    trackClear,
    curveClear: minRectDist,
    curveOverhang: minRectDist < trackClear ? trackClear - minRectDist : 0,
    street: nearestStreet
  };
}

// S-1 head 2D footprint perimeter samples (world XZ), including bracket, housing, visors, and optional backplate.
function s1HeadClearance(p, a, yCenter) {
  const fx = a.ux, fz = a.uz;
  const rx = fz, rz = -fx;
  const cx = p.x + fx * 0.18, cz = p.z + fz * 0.18;
  const hasBackplate = a.w >= 14.5 || a.lanes >= 3;
  const halfW = hasBackplate ? 0.27 : 0.15;
  const zMin = -0.30, zMax = 0.27;
  let minC = Infinity, bestInfo = null;
  for (const lx of [-halfW, 0, halfW]) {
    for (const lz of [zMin, 0, zMax]) {
      const wx = cx + rx * lx + fx * lz;
      const wz = cz + rz * lx + fz * lz;
      const info = sweepClearance(wx, wz);
      if (info.clearance < minC) { minC = info.clearance; bestInfo = { ...info, wx, wz }; }
    }
  }
  return { clearance: minC, yCenter, cx, cz, hasBackplate, ...bestInfo };
}

function segmentSweepClearance(ax, az, bx, bz, radius) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  let minC = Infinity, worst = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const info = sweepClearance(x, z);
    const c = info.clearance - radius;
    if (!worst || c < minC) { minC = c; worst = { x, z, t, ...info, clearance: c }; }
  }
  return worst;
}

// Segment-to-segment 2D intersection / closest approach for stay vs catenary wire checks.
function segSegDist2D(ax, az, bx, bz, cx, cz, dx, dz) {
  const ux = bx - ax, uz = bz - az;
  const vx = dx - cx, vz = dz - cz;
  const wx = ax - cx, wz = az - cz;
  const a = ux * ux + uz * uz;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-10) {
    sN = 0; sD = 1; tN = e; tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; }
    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else { sN = -d + b; sD = a; }
  }
  const sc = Math.abs(sN) < 1e-10 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-10 ? 0 : tN / tD;
  const px = ax + sc * ux, pz = az + sc * uz;
  const qx = cx + tc * vx, qz = cz + tc * vz;
  return { dist: Math.hypot(px - qx, pz - qz), px, pz, qx, qz };
}

function summarize(name, items, extra = {}) {
  const sorted = [...items].sort((a, b) => a.clearance - b.clearance);
  const clashes = sorted.filter((x) => x.clearance < 0);
  const mirrorHits = sorted.filter((x) => x.clearance < (TRAM_MIRROR_HALF_W - TRAM_HALF_WIDTH) && x.yMin <= 2.565 && x.yMax >= 2.435);
  return {
    name,
    count: items.length,
    minClearance: sorted.length ? Number(sorted[0].clearance.toFixed(4)) : null,
    clashes: clashes.length,
    mirrorArmRangeCount: mirrorHits.length,
    worst10: sorted.slice(0, 10).map((x) => ({
      clearance: Number(x.clearance.toFixed(4)),
      x: Number(x.x.toFixed(2)),
      z: Number(x.z.toFixed(2)),
      trackDist: Number(x.trackDist.toFixed(4)),
      curveOverhang: Number((x.curveOverhang || 0).toFixed(4)),
      street: x.street || '',
      ...extra(x)
    }))
  };
}

// Classify items
const runtimeCantilever = street.runtimeHeads.filter((h) => h.overhead && !h.span && !h.bridge);
const runtimeBridge = street.runtimeHeads.filter((h) => h.bridge);
const runtimeSpan = street.runtimeHeads.filter((h) => h.overhead && h.span);

const ordinaryPolesRes = audit.ordinaryPoles.map((p) => {
  const info = sweepClearance(p.x, p.z);
  return { x: p.x, z: p.z, clearance: info.clearance - p.r, yMin: 0.1, yMax: p.h + 0.1, ...info };
});

const ordinaryHeadsRes = audit.ordinaryHeads.map((h) => {
  const info = s1HeadClearance(h.p, h.a, S1_Y);
  return { x: info.cx, z: info.cz, clearance: info.clearance, yMin: S1_Y - (info.hasBackplate ? 0.55 : 0.43), yMax: S1_Y + (info.hasBackplate ? 0.55 : 0.43), ...info };
});

const pedHeadsRes = audit.pedHeads.map((h) => {
  const rx = h.fz, rz = -h.fx;
  const cx = h.p.x + h.fx * 0.17, cz = h.p.z + h.fz * 0.17;
  let minC = Infinity, best = null;
  for (const lx of [-0.15, 0, 0.15]) {
    for (const lz of [-0.18, 0, 0.22]) {
      const wx = cx + rx * lx + h.fx * lz;
      const wz = cz + rz * lx + h.fz * lz;
      const info = sweepClearance(wx, wz);
      if (info.clearance < minC) { minC = info.clearance; best = { ...info, x: cx, z: cz }; }
    }
  }
  return { ...best, clearance: minC, yMin: 2.15, yMax: 2.75 };
});

const cantileverMastsRes = audit.overheadPoles.filter((p) => p.h < 8).map((p) => {
  const info = sweepClearance(p.x, p.z);
  return { x: p.x, z: p.z, clearance: info.clearance - p.r, yMin: 0.1, yMax: p.h + 0.1, ...info };
});

const cantileverArmsRes = audit.cantileverArms.map((a) => {
  const worst = segmentSweepClearance(a.from.x, a.from.z, a.to.x, a.to.z, a.r);
  return { ...worst, yMin: a.y - a.r, yMax: a.y + a.r, from: a.from, to: a.to };
});

const cantileverHeadsRes = runtimeCantilever.map((h) => {
  const info = s1HeadClearance(h.p, h.a, OVERHEAD_Y);
  const hasBackplate = h.a.w >= 14.5 || h.a.lanes >= 3;
  return { x: info.cx, z: info.cz, clearance: info.clearance, yMin: OVERHEAD_Y - (hasBackplate ? 0.55 : 0.43), yMax: OVERHEAD_Y + (hasBackplate ? 0.55 : 0.43), ...info };
});

const bridgeHeadsRes = runtimeBridge.map((h) => {
  const info = s1HeadClearance(h.p, h.a, h.headY);
  const half = h.a.w >= 14.5 || h.a.lanes >= 3 ? 0.55 : 0.43;
  return { ...info, x: info.cx, z: info.cz, yMin: h.headY - half, yMax: h.headY + half };
});
const bridgeArmsRes = runtimeBridge.map((h) => {
  const worst = segmentSweepClearance(h.pole.x, h.pole.z, h.p.x, h.p.z, 0.045);
  return { ...worst, yMin: h.topY - 0.045, yMax: h.topY + 0.045 };
});

const spanMastsRes = audit.overheadPoles.filter((p) => p.h >= 8).map((p) => {
  const info = sweepClearance(p.x, p.z);
  return { x: p.x, z: p.z, clearance: info.clearance - p.r, yMin: 0.1, yMax: p.h + 0.1, ...info };
});

const spanHeadsRes = runtimeSpan.map((h) => {
  const info = s1HeadClearance(h.p, h.a, OVERHEAD_Y);
  const hasBackplate = h.a.w >= 14.5 || h.a.lanes >= 3;
  return { x: info.cx, z: info.cz, clearance: info.clearance, yMin: OVERHEAD_Y - (hasBackplate ? 0.55 : 0.43), yMax: OVERHEAD_Y + (hasBackplate ? 0.55 : 0.43), ...info };
});

// Span stays (each stay is a segment from anchor to head at topY; sag = 0 in street-details.js)
const stays = [];
for (const w of audit.spanWires) {
  stays.push({ from: w.a, to: w.head, topY: w.topY, r: w.r, isTraction: w.topY < 9 });
  stays.push({ from: w.b, to: w.head, topY: w.topY, r: w.r, isTraction: w.topY < 9 });
}

// Check every stay against tram swept envelope (crossing tracks) and against tram catenary wires & span wires
const stayCrossings = [];
let minStayAboveRoof = Infinity;
let minStayAbovePanto = Infinity;
let minStayAboveContactWire = Infinity;
let minStayAboveTramSpan = Infinity;

for (const st of stays) {
  const worstLat = segmentSweepClearance(st.from.x, st.from.z, st.to.x, st.to.z, st.r);
  const crossesEnvelope = worstLat.clearance <= 0;
  const stayBottomY = st.topY - st.r;

  // Check against all tram track segments in bbox
  const x0 = Math.min(st.from.x, st.to.x) - 5, x1 = Math.max(st.from.x, st.to.x) + 5;
  const z0 = Math.min(st.from.z, st.to.z) - 5, z1 = Math.max(st.from.z, st.to.z) + 5;
  let crossesTrack = false;
  let minWireDist2D = Infinity;
  let crossPt = null;
  const seenSeg = new Set();
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
    for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
      for (const s of segGrid.get(`${ix},${iz}`) || []) {
        if (seenSeg.has(s)) continue;
        seenSeg.add(s);
        const res = segSegDist2D(st.from.x, st.from.z, st.to.x, st.to.z, s.ax, s.az, s.bx, s.bz);
        if (res.dist < minWireDist2D) { minWireDist2D = res.dist; crossPt = res; }
        if (res.dist < 1.2) crossesTrack = true;
      }
    }
  }

  // Check against tram span wires (at 6.75 m), cantilever arms (at 6.6 m) and non-anchor tram poles (7.6 m)
  let minTramSpan3D = Infinity;
  for (const sp of tramLayout.spans) {
    const d2 = segSegDist2D(st.from.x, st.from.z, st.to.x, st.to.z, sp.ax, sp.az, sp.bx, sp.bz).dist;
    const dzY = Math.abs(st.topY - (TRAM_SPAN_Y + 0.15));
    const d3 = Math.hypot(d2, dzY);
    if (d3 < minTramSpan3D) minTramSpan3D = d3;
  }
  let minTramArm3D = Infinity;
  for (const ar of tramLayout.arms) {
    const d2 = segSegDist2D(st.from.x, st.from.z, st.to.x, st.to.z, ar.ax, ar.az, ar.bx, ar.bz).dist;
    const dzY = Math.abs(st.topY - TRAM_SPAN_Y);
    const d3 = Math.hypot(d2, dzY);
    if (d3 < minTramArm3D) minTramArm3D = d3;
  }
  let minTramPoleDist2D = Infinity;
  for (const tp of tramLayout.poles) {
    if (Math.hypot(tp.x - st.from.x, tp.z - st.from.z) < 0.05) continue;
    if (st.topY > tp.h) continue;
    const d2 = pointSegDist2D(tp.x, tp.z, st.from.x, st.from.z, st.to.x, st.to.z);
    if (d2 < minTramPoleDist2D) minTramPoleDist2D = d2;
  }

  if (crossesEnvelope || crossesTrack) {
    const clearRoof = stayBottomY - TRAM_ROOF;
    const clearPanto = stayBottomY - TRAM_PANTOGRAPH_TOP;
    const clearWire = stayBottomY - TRAM_WIRE_Y;
    const clearTramSpan = stayBottomY - (TRAM_SPAN_Y + 0.15);
    minStayAboveRoof = Math.min(minStayAboveRoof, clearRoof);
    minStayAbovePanto = Math.min(minStayAbovePanto, clearPanto);
    minStayAboveContactWire = Math.min(minStayAboveContactWire, clearWire);
    minStayAboveTramSpan = Math.min(minStayAboveTramSpan, clearTramSpan);
    stayCrossings.push({
      x: Number((crossPt ? crossPt.px : worstLat.x).toFixed(2)),
      z: Number((crossPt ? crossPt.pz : worstLat.z).toFixed(2)),
      topY: st.topY,
      isTraction: st.isTraction,
      crossesTrack,
      crossesEnvelope,
      minWireDist2D: Number(minWireDist2D.toFixed(4)),
      clearRoof: Number(clearRoof.toFixed(4)),
      clearPanto: Number(clearPanto.toFixed(4)),
      clearContactWire: Number(clearWire.toFixed(4)),
      clearTramSpan: Number(clearTramSpan.toFixed(4)),
      minTramSpan3D: Number(minTramSpan3D.toFixed(4)),
      minTramArm3D: Number(minTramArm3D.toFixed(4)),
      minTramPoleDist2D: Number(minTramPoleDist2D.toFixed(4)),
      street: worstLat.street || ''
    });
  }
}

stayCrossings.sort((a, b) => a.clearContactWire - b.clearContactWire || a.minTramSpan3D - b.minTramSpan3D);

// Vertical clearance for any cantilever arm or head that crosses the swept envelope
const armCrossings = [...cantileverArmsRes, ...bridgeArmsRes].filter((a) => a.clearance <= 0);
const headCrossings = [...cantileverHeadsRes, ...bridgeHeadsRes, ...spanHeadsRes, ...ordinaryHeadsRes]
  .filter((h) => h.clearance <= 0);

const report = {
  tramTracksCount: tramTracks.length,
  graphEdgesCount: graph.edges.length,
  curvedSectionRectsCount: curvedRectCount,
  counts: {
    ordinaryPoles: audit.ordinaryPoles.length,
    ordinaryHeads: audit.ordinaryHeads.length,
    pedHeads: audit.pedHeads.length,
    cantileverMasts6_2m: cantileverMastsRes.length,
    cantileverExtensions: audit.mastExtensions.filter((e) => e.h < 8).length,
    cantileverArms: cantileverArmsRes.length,
    cantileverHeads: cantileverHeadsRes.length,
    bridgeHeads: bridgeHeadsRes.length,
    spanMasts10m: spanMastsRes.length,
    spanExtensions: audit.mastExtensions.filter((e) => e.h >= 8).length,
    spanHeads: spanHeadsRes.length,
    spanTractionHeads: runtimeSpan.filter((h) => h.anchorTraction && h.anchorTraction.some(Boolean)).length,
    stays: stays.length
  },
  lateralClearance: {
    ordinaryPoles: summarize('ordinaryPoles', ordinaryPolesRes, () => ({})),
    ordinaryHeads: summarize('ordinaryHeads', ordinaryHeadsRes, (x) => ({ backplate: x.hasBackplate })),
    pedHeads: summarize('pedHeads', pedHeadsRes, () => ({})),
    cantileverMasts6_2m: summarize('cantileverMasts6_2m', cantileverMastsRes, () => ({})),
    cantileverArms: summarize('cantileverArms', cantileverArmsRes, () => ({ y: 5.55 })),
    cantileverHeads: summarize('cantileverHeads', cantileverHeadsRes, (x) => ({ backplate: x.hasBackplate })),
    bridgeHeads: summarize('bridgeHeads', bridgeHeadsRes, (x) => ({ backplate: x.hasBackplate })),
    bridgeArms: summarize('bridgeArms', bridgeArmsRes, () => ({})),
    spanMasts10m: summarize('spanMasts10m', spanMastsRes, () => ({})),
    spanHeads: summarize('spanHeads', spanHeadsRes, (x) => ({
      traction: !!(runtimeSpan.find((h) => Math.abs(h.p.x - (x.cx - h.a.ux * 0.18)) < 0.01 && Math.abs(h.p.z - (x.cz - h.a.uz * 0.18)) < 0.01)?.anchorTraction?.some(Boolean))
    }))
  },
  verticalCrossings: {
    cantileverArmCrossings: armCrossings.length,
    headCrossings: headCrossings.length,
    stayCrossingsCount: stayCrossings.length,
    minStayAboveRoof: stayCrossings.length ? Number(minStayAboveRoof.toFixed(4)) : null,
    minStayAbovePantographTop: stayCrossings.length ? Number(minStayAbovePanto.toFixed(4)) : null,
    minStayAboveContactWire: stayCrossings.length ? Number(minStayAboveContactWire.toFixed(4)) : null,
    minStayAboveTramSpanWire: stayCrossings.length ? Number(minStayAboveTramSpan.toFixed(4)) : null,
    stayWireClashesBelow5_8m: stayCrossings.filter((s) => s.clearContactWire < 0).length,
    worst10Stays: stayCrossings.slice(0, 10)
  }
};

console.log(JSON.stringify(report, null, 2));
