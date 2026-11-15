// Shared harness for the bridge parapet audit (tools/audit-bridge-parapets.mjs) and its regression test: builds every
// bridge with a recording three.js stub, classifies the instanced members that stand on the street (parapet railings,
// kerbs and copings, balustrade panels, lamp posts, arch hangers) and measures how far each reaches into a 3.6 m car
// lane envelope of the road network the city paints (straight lanes and junction turning curves).
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./module.cjs');
const { THREE } = require('./three-stub.cjs');

const LANE_HALF = 1.8;
const STEP = 0.25;

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_target, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

// Every instanced member (a unit box under its matrix) and every balustrade panel (a 2.4 m panel under its matrix)
function loadRecordingBridges(root, bridgesSource, config, GEO) {
  const panels = [];
  class RecordingMesh extends THREE.InstancedMesh {
    constructor(geometry, material, count) {
      super(geometry, material, count);
      this.records = [];
    }
    setMatrixAt(_i, m) { this.records.push(m.elements.slice()); }
  }
  class PanelGeometry extends THREE.ExtrudeGeometry {
    clone() {
      const g = new THREE.BufferGeometry();
      g.applyMatrix4 = (m) => { panels.push(m.elements.slice()); return g; };
      return g;
    }
  }
  const three = { ...THREE, InstancedMesh: RecordingMesh, ExtrudeGeometry: PanelGeometry };
  const mod = loadModule(bridgesSource || readFileSync(join(root, 'js/bridges.js'), 'utf8'), {
    imports: {
      'three/webgpu': three,
      'three/tsl': inert(),
      './tsl-materials.js': inert(),
      './city-config.js': config,
      './geodata.js': { GEO },
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: () => null }
    },
    globals: { console: { info() {}, log() {}, warn() {} }, performance, Float32Array, Math, Object, Array, Map, Set },
    filename: 'bridges.js'
  });
  return { mod, panels };
}

// The xz footprint of a box under matrix e (unit box for members, the panel's 2.4 x 0.94 x 0.25 for panels) as a centre
// line (the longest horizontal half axis) with a half thickness, and its y range
function footprint(e, size) {
  const axes = [0, 1, 2].map((k) => ({
    x: e[k * 4] * size[k] * 0.5, y: e[k * 4 + 1] * size[k] * 0.5, z: e[k * 4 + 2] * size[k] * 0.5
  }));
  const cx = e[12], cy = e[13], cz = e[14];
  const hy = axes.reduce((s, a) => s + Math.abs(a.y), 0);
  const flat = axes.map((a) => Math.hypot(a.x, a.z));
  const k = flat.indexOf(Math.max(...flat));
  const thick = flat.reduce((s, v, i) => s + (i === k ? 0 : v), 0);
  return { cx, cz, ux: axes[k].x, uz: axes[k].z, half: flat[k], thick, y0: cy - hy, y1: cy + hy };
}

// What a member is, from its size and height: lamp posts are thin and 7 m tall, parapet parts sit within 0.25-2.5 m
// above the street, hangers and arch ribs reach higher; deck slabs, curbs and overhead bracing are left out
function classify(fp) {
  const height = fp.y1 - fp.y0;
  if (fp.y0 > 4.5 || fp.y1 < 0.25) return null;
  if (height > 5 && fp.half < 0.3 && fp.thick < 0.3) return 'lamp';
  if (fp.y1 <= 2.5) return 'parapet';
  return 'structure';
}

function laneSegments(network) {
  const segs = [];
  const shiftAt = network.laneShiftAt;
  for (const e of network.paintEdges || network.edges) {
    const span = e.span ?? e.len;
    for (const o of e.lanes) {
      const steps = e.laneShift ? Math.max(1, Math.ceil(span / 8)) : 1;
      let ax = e.x0 + e.rx * (o + shiftAt(e, 0));
      let az = e.z0 + e.rz * (o + shiftAt(e, 0));
      for (let k = 1; k <= steps; k++) {
        const s = (span * k) / steps;
        const off = o + shiftAt(e, s);
        const bx = e.x0 + e.dx * s + e.rx * off, bz = e.z0 + e.dz * s + e.rz * off;
        segs.push({ ax, az, bx, bz, curve: false });
        ax = bx;
        az = bz;
      }
    }
  }
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const e of network.edges) {
    for (const m of e.moves || []) {
      for (let i = 0; i < m.out.length; i++) {
        if (m.out[i] < 0) continue;
        const c = network.connector(e, i, m.to, m.out[i]);
        network.curvePoint(c, 0, p);
        for (let k = 1; k <= 8; k++) {
          const ax = p.x, az = p.z;
          network.curvePoint(c, (c.len * k) / 8, p);
          segs.push({ ax, az, bx: p.x, bz: p.z, curve: true });
        }
      }
    }
  }
  return segs;
}

function segmentGrid(segs, cell = 16) {
  const grid = new Map();
  for (const s of segs) {
    const i0 = Math.floor((Math.min(s.ax, s.bx) - 4) / cell), i1 = Math.floor((Math.max(s.ax, s.bx) + 4) / cell);
    const j0 = Math.floor((Math.min(s.az, s.bz) - 4) / cell), j1 = Math.floor((Math.max(s.az, s.bz) + 4) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = i * 100000 + j;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(s);
      }
    }
  }
  // Nearest lane centreline within 4 m of (x, z): its distance and whether it is a turning curve
  return (x, z) => {
    const list = grid.get(Math.floor(x / cell) * 100000 + Math.floor(z / cell));
    let best = Infinity, curve = false;
    if (!list) return { d: best, curve };
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz;
      const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2)) : 0;
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d < best) { best = d; curve = s.curve; }
    }
    return { d: best, curve };
  };
}

// Builds the bridges and the network and measures every standing member against the lanes. `bridgesSource` replaces
// js/bridges.js (the audit's --before); `network` reuses a built one.
function auditBridgeParapets({ root = join(__dirname, '../..'), bridgesSource = null, network = null } = {}) {
  const config = require(join(root, 'js/city-config.js'));
  const { GEO } = require(join(root, 'js/geodata.js'));
  if (!network) {
    const road = loadModule(readFileSync(join(root, 'js/road-network.js'), 'utf8'), {
      imports: { './city-config.js': config, './geodata.js': { GEO } },
      globals: { console: { info() {}, log() {}, warn() {} } },
      filename: 'road-network.js'
    });
    network = road.buildRoadNetwork([], []);
  }
  const nearest = segmentGrid(laneSegments(network));
  const { mod, panels } = loadRecordingBridges(root, bridgesSource, config, GEO);
  const { group, colliders } = mod.buildBridges(new THREE.Group());

  const members = [];
  for (const mesh of group.children) {
    for (const e of mesh.records || []) members.push({ name: mesh.name, fp: footprint(e, [1, 1, 1]) });
  }
  // Panels are merged per structure, so their bridge is found by the nearest member afterwards
  for (const e of panels) members.push({ name: null, panel: true, fp: footprint(e, [2.4, 0.94, 0.25]) });
  const named = members.filter((m) => m.name);
  for (const m of members) {
    if (m.name) continue;
    let best = Infinity;
    for (const n of named) {
      const d = Math.hypot(n.fp.cx - m.fp.cx, n.fp.cz - m.fp.cz);
      if (d < best) { best = d; m.name = n.name; }
    }
  }

  const rows = [];
  const counts = { parapet: 0, panel: 0, lamp: 0, structure: 0 };
  const membersByBridge = {};
  const standing = [];
  for (const m of members) {
    let type = classify(m.fp);
    if (!type) continue;
    if (m.panel) type = 'panel';
    counts[type]++;
    const tally = (membersByBridge[m.name || 'Bridge'] ||= { parapet: 0, panel: 0, lamp: 0, structure: 0 });
    tally[type]++;
    standing.push({ name: m.name, type, x: m.fp.cx, z: m.fp.cz, half: m.fp.half });
    const { cx, cz, ux, uz, half, thick } = m.fp;
    const n = Math.max(1, Math.ceil((2 * half) / STEP));
    let depth = -Infinity, hit = 0, worst = null, curve = false;
    for (let k = 0; k <= n; k++) {
      const u = -1 + (2 * k) / n;
      const x = cx + ux * u, z = cz + uz * u;
      const near = nearest(x, z);
      const dd = LANE_HALF + thick - near.d;
      if (dd > 0) hit++;
      if (dd > depth) { depth = dd; worst = { x, z }; curve = near.curve; }
    }
    if (depth <= 1e-6) continue;
    rows.push({
      name: m.name, type, x: +worst.x.toFixed(1), z: +worst.z.toFixed(1), depth: +depth.toFixed(2),
      length: +((hit * 2 * half) / (n + 1)).toFixed(1), curve
    });
  }
  rows.sort((a, b) => b.depth - a.depth);

  const colliderRows = [];
  for (const c of colliders) {
    const o = c.obb;
    if (!o) continue;
    // obb local frame: lx along (cs, -sn), lz across (sn, cs) (bridges.js addBridgeCollider)
    const n = Math.max(1, Math.ceil((2 * o.hx) / STEP));
    let depth = -Infinity, worst = null;
    for (let k = 0; k <= n; k++) {
      const u = -o.hx + (2 * o.hx * k) / n;
      const x = o.cx + o.cs * u, z = o.cz - o.sn * u;
      const dd = LANE_HALF + o.hz - nearest(x, z).d;
      if (dd > depth) { depth = dd; worst = { x, z }; }
    }
    if (depth > 1e-6) colliderRows.push({ x: +worst.x.toFixed(1), z: +worst.z.toFixed(1), depth: +depth.toFixed(2) });
  }
  colliderRows.sort((a, b) => b.depth - a.depth);

  const byBridge = {};
  for (const r of rows) {
    const b = (byBridge[r.name || 'Bridge'] ||= { parapet: 0, panel: 0, lamp: 0, structure: 0, maxDepth: 0 });
    b[r.type]++;
    b.maxDepth = Math.max(b.maxDepth, r.depth);
  }
  return { counts, membersByBridge, standing, rows, byBridge, colliders: colliders.length, colliderRows, structures: mod.bridgeStructures() };
}

module.exports = { auditBridgeParapets, laneSegments, LANE_HALF };
