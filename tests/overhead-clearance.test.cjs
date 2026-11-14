'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/module.cjs');
const { THREE } = require('./helpers/three-stub.cjs');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function segDistSq(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
  const dx = ax + ex * t - px, dz = az + ez * t - pz;
  return dx * dx + dz * dz;
}

test('canopy columns stay clear of road lanes and connectors', () => {
  const geo = loadModule(read('js/geodata.js'), { imports: {} }).GEO;
  const cfg = loadModule(read('js/city-config.js'), {
    imports: { 'three/webgpu': THREE, './geodata.js': { GEO: geo } }
  });
  const net = loadModule(read('js/road-network.js'), {
    imports: { 'three/webgpu': THREE, './geodata.js': { GEO: geo }, './city-config.js': cfg }
  }).buildRoadNetwork([], []);

  const CELL = 32;
  const cells = new Map();
  const addSeg = (ax, az, bx, bz) => {
    const ix0 = Math.floor(Math.min(ax, bx) / CELL), ix1 = Math.floor(Math.max(ax, bx) / CELL);
    const iz0 = Math.floor(Math.min(az, bz) / CELL), iz1 = Math.floor(Math.max(az, bz) / CELL);
    const s = { ax, az, bx, bz };
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = `${ix},${iz}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(s);
      }
    }
  };
  for (const e of net.edges) {
    if (!e.lanes || !e.lanes.length) continue;
    for (const off of e.lanes) {
      const ox = e.rx * off, oz = e.rz * off;
      addSeg(e.sx + ox, e.sz + oz, e.sx + e.dx * e.len + ox, e.sz + e.dz * e.len + oz);
    }
    for (const m of e.moves || []) {
      const f = m.to;
      if (!f || !m.out) continue;
      for (let i = 0; i < e.lanes.length; i++) {
        const j = m.out[i];
        if (j == null || j < 0) continue;
        const c = net.connector(e, i, f, j);
        if (!c) continue;
        const n = Math.max(2, Math.ceil(c.len / 2));
        let prev = net.curvePoint(c, 0, { x: 0, z: 0 });
        for (let k = 1; k <= n; k++) {
          const cur = net.curvePoint(c, (c.len * k) / n, { x: 0, z: 0 });
          addSeg(prev.x, prev.z, cur.x, cur.z);
          prev = cur;
        }
      }
    }
  }

  const busHalfW = 1.275; // BUS_SPEC.w / 2
  const hits = [];
  for (let i = 0; i < geo.canopies.length; i++) {
    const c = geo.canopies[i];
    for (let k = 0; k + 1 < c.columns.length; k += 2) {
      const x = c.columns[k], z = c.columns[k + 1];
      const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const s of cells.get(`${ix + dx},${iz + dz}`) || []) {
            if (segDistSq(x, z, s.ax, s.az, s.bx, s.bz) < busHalfW * busHalfW) {
              hits.push(`${c.kind}#${i} (${x},${z})`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(hits, []);
});

test('canopies over tram tracks clear TRAM_PANTOGRAPH_HEAD including 0.28 m edge beam', () => {
  const geo = loadModule(read('js/geodata.js'), { imports: {} }).GEO;
  const TRAM_PANTO_TOP = 5.795; // TRAM_PANTOGRAPH_HEAD (5.77) + collector half-height (0.025)
  const tramHalfW = 1.225; // TRAM_PROFILE.w / 2

  const CELL = 32;
  const cells = new Map();
  for (const r of geo.rail) {
    if (r.kind !== 'tram') continue;
    for (let i = 0; i + 2 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
      const ix0 = Math.floor((Math.min(ax, bx) - 2) / CELL), ix1 = Math.floor((Math.max(ax, bx) + 2) / CELL);
      const iz0 = Math.floor((Math.min(az, bz) - 2) / CELL), iz1 = Math.floor((Math.max(az, bz) + 2) / CELL);
      const s = { ax, az, bx, bz };
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = `${ix},${iz}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(s);
        }
      }
    }
  }

  const clashes = [];
  for (let i = 0; i < geo.canopies.length; i++) {
    const c = geo.canopies[i];
    if (c.clearance - 0.28 >= TRAM_PANTO_TOP) continue;
    const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
    const hx = c.w * 0.5, hz = c.d * 0.5;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz + tramHalfW;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz + tramHalfW;
    const seen = new Set();
    let overlaps = false;
    for (let ix = Math.floor((c.cx - ex) / CELL); ix <= Math.floor((c.cx + ex) / CELL) && !overlaps; ix++) {
      for (let iz = Math.floor((c.cz - ez) / CELL); iz <= Math.floor((c.cz + ez) / CELL) && !overlaps; iz++) {
        for (const s of cells.get(`${ix},${iz}`) || []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const steps = Math.max(2, Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / 0.5));
          for (let t = 0; t <= steps; t++) {
            const f = t / steps;
            const dx = s.ax + (s.bx - s.ax) * f - c.cx;
            const dz = s.az + (s.bz - s.az) * f - c.cz;
            const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;
            if (Math.hypot(Math.max(0, Math.abs(u) - hx), Math.max(0, Math.abs(v) - hz)) < tramHalfW) {
              overlaps = true;
              break;
            }
          }
        }
      }
    }
    if (overlaps) clashes.push(`${c.kind}#${i} beam=${(c.clearance - 0.28).toFixed(2)}`);
  }
  assert.deepEqual(clashes, []);
});

test('rail portals and droppers add rail.elevationAt on viaducts and ramps', () => {
  const src = read('js/tram-infra.js');
  const portalBlock = src.match(/for \(const p of rail\.portals\)\s*\{[\s\S]*?\}/);
  assert.ok(portalBlock, 'rail.portals loop found');
  assert.match(portalBlock[0], /rail\.elevationAt/);
  assert.match(portalBlock[0], /yElev \+ 8\.9/);

  const dropperBlock = src.match(/for \(const d of rail\.droppers\)\s*\{[\s\S]*?\}/);
  assert.ok(dropperBlock, 'rail.droppers loop found');
  assert.match(dropperBlock[0], /rail\.elevationAt/);
  assert.match(dropperBlock[0], /yElev \+ RAIL_WIRE_Y/);
  assert.match(dropperBlock[0], /yElev \+ 8\.65/);
});
