// Headless audit: every building footprint as actually built by buildings.js, measured with exact
// polygon-to-segment distance against GEO.rail (0.5 m keep-out).
//
//   node tools/audit-building-rails.mjs [--json] [--top N] [--near x,z,r] [--block ID]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_t, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in values ? values[key] : (values[key] = inert());
    },
    set(_t, key, value) { values[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distPointToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function orient2d(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = orient2d(cx, cz, dx, dz, ax, az);
  const d2 = orient2d(cx, cz, dx, dz, bx, bz);
  const d3 = orient2d(ax, az, bx, bz, cx, cz);
  const d4 = orient2d(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (px, pz, qx, qz, rx, rz) =>
    rx >= Math.min(px, qx) - 1e-9 && rx <= Math.max(px, qx) + 1e-9 &&
    rz >= Math.min(pz, qz) - 1e-9 && rz <= Math.max(pz, qz) + 1e-9;
  if (Math.abs(d1) < 1e-9 && onSeg(cx, cz, dx, dz, ax, az)) return true;
  if (Math.abs(d2) < 1e-9 && onSeg(cx, cz, dx, dz, bx, bz)) return true;
  if (Math.abs(d3) < 1e-9 && onSeg(ax, az, bx, bz, cx, cz)) return true;
  if (Math.abs(d4) < 1e-9 && onSeg(ax, az, bx, bz, dx, dz)) return true;
  return false;
}

function distPolyToSeg(poly, ax, az, bx, bz) {
  if (pointInPoly(poly, ax, az) || pointInPoly(poly, bx, bz)) return 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    if (segmentsIntersect(p.x, p.z, q.x, q.z, ax, az, bx, bz)) return 0;
  }
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    best = Math.min(
      best,
      distPointToSeg(p.x, p.z, ax, az, bx, bz),
      distPointToSeg(ax, az, p.x, p.z, q.x, q.z),
      distPointToSeg(bx, bz, p.x, p.z, q.x, q.z)
    );
  }
  return best;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  }
  return Math.abs(a) * 0.5;
}

function buildSegIndex(segments, cellSize, pad) {
  const grid = new Map();
  for (const seg of segments) {
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / cellSize);
    const x1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / cellSize);
    const z0 = Math.floor((Math.min(seg.az, seg.bz) - pad) / cellSize);
    const z1 = Math.floor((Math.max(seg.az, seg.bz) + pad) / cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 100003 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(seg);
      }
    }
  }
  return (x0, x1, z0, z1) => {
    const out = new Set();
    const ix0 = Math.floor((x0 - pad) / cellSize);
    const ix1 = Math.floor((x1 + pad) / cellSize);
    const iz0 = Math.floor((z0 - pad) / cellSize);
    const iz1 = Math.floor((z1 + pad) / cellSize);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = grid.get(ix * 100003 + iz);
        if (list) for (const s of list) out.add(s);
      }
    }
    return out;
  };
}

export async function runAudit() {
  const { GEO } = await import('../js/geodata.js');
  const stub = inert();
  const globals = {
    document: stub,
    console: { info() {}, warn() {}, log() {} },
    Math, Object, Array, Set, Map, Number, Infinity, JSON, Symbol,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error
  };
  const rendering = {
    'three/webgpu': stub,
    'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub,
    './tsl-materials.js': stub
  };

  const config = loadModule(source('city-config'), {
    imports: { './geodata.js': { GEO } },
    globals
  });

  const gridModule = loadModule(
    source('city-grid') + '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }',
    { imports: { ...rendering, './city-config.js': config, './geodata.js': { GEO } }, globals }
  );
  gridModule.buildCityGrid(stub);
  const liveGrid = { ...gridModule, ...gridModule.snapshot() };

  const bld = loadModule(source('buildings'), {
    imports: {
      ...rendering,
      './balconies.js': stub,
      './roofs.js': stub,
      './city-config.js': config,
      './geodata.js': { GEO },
      './city-grid.js': liveGrid
    },
    globals
  }).buildCityBlocks(stub);

  const railSegs = [];
  for (const chain of GEO.rail || []) {
    const pts = chain.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      railSegs.push({ ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3] });
    }
  }
  const queryRail = buildSegIndex(railSegs, 32, 10);
  const blockById = new Map(config.BLOCKS.map((b) => [b.id, b]));
  const RAIL_KEEP = 0.5;

  const records = [];
  const blockStats = new Map();

  for (const blk of bld.allBlocks) {
    const srcId = blk.srcBlockId;
    if (srcId !== null && srcId !== undefined && !blockStats.has(srcId)) {
      const src = blockById.get(srcId);
      blockStats.set(srcId, {
        srcBlockId: srcId,
        district: blk.district,
        blockArea: src ? src.area : 0,
        footprints: 0,
        groundArea: 0,
        onRail: 0
      });
    }
    const bs = blockStats.get(srcId);
    for (const f of blk.footprints) {
      const poly = f.pts || [
        { x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 },
        { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }
      ];
      const x0 = Math.min(...poly.map((p) => p.x));
      const x1 = Math.max(...poly.map((p) => p.x));
      const z0 = Math.min(...poly.map((p) => p.z));
      const z1 = Math.max(...poly.map((p) => p.z));
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const area = polyArea(poly);

      let railDist = Infinity;
      for (const s of queryRail(x0, x1, z0, z1)) {
        const d = distPolyToSeg(poly, s.ax, s.az, s.bx, s.bz);
        if (d < railDist) railDist = d;
      }

      const viol = railDist < RAIL_KEEP;
      if (bs) {
        bs.footprints++;
        if ((f.y0 || 0) < 0.01) bs.groundArea += area;
        if (viol) bs.onRail++;
      }
      records.push({
        srcBlockId: srcId,
        blockId: blk.id,
        district: blk.district,
        cx: +cx.toFixed(2),
        cz: +cz.toFixed(2),
        w: +Math.hypot(poly[1].x - poly[0].x, poly[1].z - poly[0].z).toFixed(2),
        d: +Math.hypot(poly[2].x - poly[1].x, poly[2].z - poly[1].z).toFixed(2),
        ry: +(blk.ry || 0).toFixed(4),
        y0: +(f.y0 || 0).toFixed(2),
        h: +(f.h || 0).toFixed(2),
        area: +area.toFixed(1),
        railDist: Number.isFinite(railDist) ? +railDist.toFixed(4) : null,
        viol
      });
    }
  }

  return {
    totalFootprints: records.length,
    totalBlocks: blockStats.size,
    records,
    blockStats: [...blockStats.values()]
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const topIdx = args.indexOf('--top');
  const top = topIdx >= 0 ? Number(args[topIdx + 1]) : 20;
  const nearIdx = args.indexOf('--near');
  const near = nearIdx >= 0 ? args[nearIdx + 1].split(',').map(Number) : null;
  const blkIdx = args.indexOf('--block');
  const blkFilter = blkIdx >= 0 ? Number(args[blkIdx + 1]) : null;

  const result = await runAudit();
  let list = result.records;
  if (near && near.length === 3) {
    const [nx, nz, nr] = near;
    list = list.filter((r) => Math.hypot(r.cx - nx, r.cz - nz) <= nr);
  }
  if (blkFilter !== null && Number.isFinite(blkFilter)) {
    list = list.filter((r) => r.srcBlockId === blkFilter);
  }
  const viols = list.filter((r) => r.viol).sort((a, b) => a.railDist - b.railDist);
  const closest = [...list]
    .filter((r) => r.railDist !== null)
    .sort((a, b) => a.railDist - b.railDist)
    .slice(0, top);

  const byBlock = {};
  for (const r of viols) byBlock[r.srcBlockId] = (byBlock[r.srcBlockId] || 0) + 1;
  const b1257 = result.blockStats.find((b) => b.srcBlockId === 1257);

  if (asJson) {
    console.log(JSON.stringify({
      totalFootprints: result.totalFootprints,
      filteredFootprints: list.length,
      violations: viols.length,
      byBlock,
      block1257: b1257 ? { ...b1257, builtShare: +(b1257.groundArea / b1257.blockArea).toFixed(4) } : null,
      viols,
      closest
    }, null, 2));
  } else {
    console.log(`Building footprints audited: ${list.length} (city-wide ${result.totalFootprints})`);
    console.log(`Rail violations (< 0.5 m): ${viols.length}`);
    if (Object.keys(byBlock).length) console.log(`Violations by block: ${JSON.stringify(byBlock)}`);
    if (b1257) {
      console.log(`Block 1257: ${b1257.footprints} footprints, groundArea=${b1257.groundArea.toFixed(1)} m², blockArea=${b1257.blockArea.toFixed(1)} m², builtShare=${((b1257.groundArea / b1257.blockArea) * 100).toFixed(2)}%`);
    }
    if (viols.length) {
      console.log(`\nViolations (${viols.length}):`);
      for (const r of viols) {
        console.log(`  block ${r.srcBlockId} (${r.blockId}) @ (${r.cx}, ${r.cz}) ${r.w}x${r.d}m ry=${r.ry} y0=${r.y0} h=${r.h} rail=${r.railDist}m`);
      }
    }
    console.log(`\nClosest ${top} footprints to rail/tram track:`);
    for (const r of closest) {
      console.log(`  block ${r.srcBlockId} (${r.blockId}) @ (${r.cx}, ${r.cz}) ${r.w}x${r.d}m rail=${r.railDist}m`);
    }
  }
}
