// Headless audit: every courtyard / yard / lawn slab as actually built by buildings.js (after clipYard),
// measured with exact polygon-to-segment and polygon-to-polygon geometry (not 2 m sample probes).
//
//   node tools/audit-courtyards.mjs [--json] [--top N] [--near x,z,r]
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

// ============================================================================
// Exact 2D XZ geometry helpers
// ============================================================================

export function slabCorners(r) {
  const cx = (r.x0 + r.x1) * 0.5;
  const cz = (r.z0 + r.z1) * 0.5;
  const hx = (r.x1 - r.x0) * 0.5;
  const hz = (r.z1 - r.z0) * 0.5;
  const cs = Math.cos(r.ry || 0);
  const sn = Math.sin(r.ry || 0);
  const pt = (u, v) => ({ x: cx + u * cs + v * sn, z: cz - u * sn + v * cs });
  return [pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)];
}

export function pointInPoly(poly, x, z) {
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

export function distPointToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function orient2d(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

export function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
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

export function segmentsProperlyIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = orient2d(cx, cz, dx, dz, ax, az);
  const d2 = orient2d(cx, cz, dx, dz, bx, bz);
  const d3 = orient2d(ax, az, bx, bz, cx, cz);
  const d4 = orient2d(ax, az, bx, bz, dx, dz);
  const eps = 1e-9;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
         ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

export function distPolyToSeg(poly, ax, az, bx, bz) {
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

export function distPointToOutline(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distPointToSeg(x, z, poly[j].x, poly[j].z, poly[i].x, poly[i].z));
  }
  return best;
}

export function slabOutsideCurbIsland(slabPoly, curbPoly) {
  let outside = false;
  let maxOverhang = 0;
  const eps = 1e-6;
  for (const c of slabPoly) {
    if (!pointInPoly(curbPoly, c.x, c.z)) {
      const d = distPointToOutline(curbPoly, c.x, c.z);
      if (d > eps) {
        outside = true;
        if (d > maxOverhang) maxOverhang = d;
      }
    }
  }
  for (let i = 0; i < slabPoly.length; i++) {
    const a = slabPoly[i], b = slabPoly[(i + 1) % slabPoly.length];
    for (let j = 0, k = curbPoly.length - 1; j < curbPoly.length; k = j++) {
      const c = curbPoly[k], d = curbPoly[j];
      if (segmentsProperlyIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z)) {
        outside = true;
      }
    }
  }
  for (const v of curbPoly) {
    if (pointInPoly(slabPoly, v.x, v.z)) {
      const d = distPointToOutline(slabPoly, v.x, v.z);
      if (d > eps) {
        outside = true;
        if (d > maxOverhang) maxOverhang = d;
      }
    }
  }
  return { outside, maxOverhang };
}

function buildSegIndex(segments, cellSize, padFn) {
  const grid = new Map();
  for (const seg of segments) {
    const pad = padFn(seg);
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
  return (x0, x1, z0, z1, pad) => {
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

// ============================================================================
// World build and audit
// ============================================================================

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

  // Load city-config with LANE_GUIDE exported so we audit against the exact carriageway model.
  const config = loadModule(source('city-config') + '\nexport { LANE_GUIDE };', {
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

  const CELL = 32;
  const roadSegs = config.LANE_GUIDE.map(([ax, az, bx, bz, half]) => ({ ax, az, bx, bz, half }));
  const pedSegs = [];
  for (const way of config.PEDESTRIAN_WAYS) {
    const half = way.w * 0.5;
    for (let i = 0; i + 1 < way.pts.length; i++) {
      pedSegs.push({
        ax: way.pts[i].x, az: way.pts[i].z,
        bx: way.pts[i + 1].x, bz: way.pts[i + 1].z,
        half, name: way.name
      });
    }
  }
  const railSegs = [];
  for (const chain of GEO.rail || []) {
    const pts = chain.pts || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      railSegs.push({ ax: pts[i], az: pts[i + 1], bx: pts[i + 2], bz: pts[i + 3] });
    }
  }

  // Pad generously (half + 20 m) so no carriageway within 20 m is ever missed across cell boundaries.
  const queryRoad = buildSegIndex(roadSegs, CELL, (s) => s.half + 20);
  const queryPed = buildSegIndex(pedSegs, CELL, (s) => s.half + 10);
  const queryRail = buildSegIndex(railSegs, CELL, () => 10);

  const blockById = new Map(config.BLOCKS.map((b) => [b.id, b]));

  // Find named-area blocks by matching ROADS polylines within 15 m of each block's curb polygon.
  const namedAreas = ['Podgórna', 'Strzelecka', 'Plac Wiosny Ludów'];
  const areaBlockSets = new Map(namedAreas.map((n) => [n, new Set()]));
  for (const name of namedAreas) {
    const roads = config.ROADS.filter((r) => r.name === name);
    for (const b of config.BLOCKS) {
      if (!b.poly || b.poly.length < 3) continue;
      let minDist = Infinity;
      for (const r of roads) {
        const half = (r.w || 0) * 0.5;
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const a = r.pts[i], c = r.pts[i + 1];
          if (Math.max(a.x, c.x) < b.minX - 25 || Math.min(a.x, c.x) > b.maxX + 25) continue;
          if (Math.max(a.z, c.z) < b.minZ - 25 || Math.min(a.z, c.z) > b.maxZ + 25) continue;
          minDist = Math.min(minDist, distPolyToSeg(b.poly, a.x, a.z, c.x, c.z) - half);
        }
      }
      if (minDist <= 15) areaBlockSets.get(name).add(b.id);
    }
  }
  const kupiecBlockId = 792;
  const allNamedBlockIds = new Set([kupiecBlockId]);
  for (const s of areaBlockSets.values()) for (const id of s) allNamedBlockIds.add(id);

  // Measure every built slab.
  const records = [];
  const ROAD_KEEP = 4.6;
  const CORRIDOR_KEEP = 0.5;

  for (const blk of bld.allBlocks) {
    const srcBlock = blk.srcBlockId !== null && blk.srcBlockId !== undefined ? blockById.get(blk.srcBlockId) : null;
    for (const r of blk.yards) {
      const corners = slabCorners(r);
      const x0 = Math.min(...corners.map((p) => p.x));
      const x1 = Math.max(...corners.map((p) => p.x));
      const z0 = Math.min(...corners.map((p) => p.z));
      const z1 = Math.max(...corners.map((p) => p.z));
      const cx = (r.x0 + r.x1) * 0.5;
      const cz = (r.z0 + r.z1) * 0.5;

      let roadDist = Infinity;
      for (const s of queryRoad(x0, x1, z0, z1, 20)) {
        const d = distPolyToSeg(corners, s.ax, s.az, s.bx, s.bz) - s.half;
        if (d < roadDist) roadDist = d;
      }

      let pedDist = Infinity;
      for (const s of queryPed(x0, x1, z0, z1, 10)) {
        const d = distPolyToSeg(corners, s.ax, s.az, s.bx, s.bz) - s.half;
        if (d < pedDist) pedDist = d;
      }

      let railDist = Infinity;
      for (const s of queryRail(x0, x1, z0, z1, 10)) {
        const d = distPolyToSeg(corners, s.ax, s.az, s.bx, s.bz);
        if (d < railDist) railDist = d;
      }

      const curb = srcBlock && srcBlock.poly && srcBlock.poly.length >= 3
        ? slabOutsideCurbIsland(corners, srcBlock.poly)
        : { outside: true, maxOverhang: Infinity };

      const roadViol = roadDist < ROAD_KEEP;
      const pedViol = pedDist < CORRIDOR_KEEP;
      const railViol = railDist < CORRIDOR_KEEP;
      const curbViol = curb.outside;
      const anyViol = roadViol || pedViol || railViol || curbViol;

      const areas = [];
      for (const name of namedAreas) {
        if (areaBlockSets.get(name).has(blk.srcBlockId)) areas.push(name);
      }
      if (blk.srcBlockId === kupiecBlockId) areas.push('Kupiec Poznański');

      records.push({
        blockId: blk.id,
        srcBlockId: blk.srcBlockId,
        district: blk.district,
        cx: +cx.toFixed(2),
        cz: +cz.toFixed(2),
        w: +(r.x1 - r.x0).toFixed(2),
        d: +(r.z1 - r.z0).toFixed(2),
        ry: +(r.ry || 0).toFixed(4),
        roadDist: Number.isFinite(roadDist) ? +roadDist.toFixed(4) : null,
        pedDist: Number.isFinite(pedDist) ? +pedDist.toFixed(4) : null,
        railDist: Number.isFinite(railDist) ? +railDist.toFixed(4) : null,
        curbOutside: curb.outside,
        curbOverhang: Number.isFinite(curb.maxOverhang) ? +curb.maxOverhang.toFixed(4) : null,
        roadViol,
        pedViol,
        railViol,
        curbViol,
        anyViol,
        areas
      });
    }
  }

  return {
    records,
    areaBlocks: Object.fromEntries([...areaBlockSets.entries()].map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
    kupiecBlockId,
    allNamedBlockIds: [...allNamedBlockIds].sort((a, b) => a - b)
  };
}

// ============================================================================
// CLI entry point
// ============================================================================

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const topIndex = args.indexOf('--top');
  const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 10;
  const nearIndex = args.indexOf('--near');
  const near = nearIndex >= 0 ? args[nearIndex + 1].split(',').map(Number) : null;

  const result = await runAudit();
  let list = result.records;
  if (near) {
    const [nx, nz, nr] = near;
    list = list.filter((r) => Math.hypot(r.cx - nx, r.cz - nz) <= nr);
  }

  const roadViols = list.filter((r) => r.roadViol);
  const pedViols = list.filter((r) => r.pedViol);
  const railViols = list.filter((r) => r.railViol);
  const curbViols = list.filter((r) => r.curbViol);
  const anyViols = list.filter((r) => r.anyViol);
  const namedList = list.filter((r) => r.areas.length > 0);
  const namedViols = namedList.filter((r) => r.anyViol);

  const closestRoad = [...list].filter((r) => r.roadDist !== null).sort((a, b) => a.roadDist - b.roadDist).slice(0, top);
  const closestPed = [...list].filter((r) => r.pedDist !== null).sort((a, b) => a.pedDist - b.pedDist).slice(0, top);
  const closestRail = [...list].filter((r) => r.railDist !== null).sort((a, b) => a.railDist - b.railDist).slice(0, top);

  if (jsonMode) {
    console.log(JSON.stringify({
      total: list.length,
      violations: {
        any: anyViols.length,
        road: roadViols.length,
        ped: pedViols.length,
        rail: railViols.length,
        curb: curbViols.length
      },
      areaBlocks: result.areaBlocks,
      kupiecBlockId: result.kupiecBlockId,
      namedTotal: namedList.length,
      namedViolations: namedViols.length,
      namedSlabs: namedList,
      allViolations: anyViols,
      closestRoad,
      closestPed,
      closestRail
    }, null, 2));
  } else {
    console.log(`Courtyard slabs audited: ${list.length}`);
    console.log(`Violations (total ${anyViols.length}): road<4.6m=${roadViols.length}, ped<0.5m=${pedViols.length}, rail<0.5m=${railViols.length}, outsideCurb=${curbViols.length}`);
    console.log(`\nNamed area blocks:`);
    for (const [name, ids] of Object.entries(result.areaBlocks)) {
      console.log(`  ${name}: [${ids.join(', ')}]`);
    }
    console.log(`  Kupiec Poznański: [${result.kupiecBlockId}]`);
    console.log(`\nNamed areas: ${namedList.length} slabs, ${namedViols.length} violations`);
    for (const r of namedList) {
      console.log(`  block ${r.srcBlockId} (${r.blockId}) @ (${r.cx}, ${r.cz}) ${r.w}x${r.d}m ry=${r.ry} [${r.areas.join(', ')}] road=${r.roadDist}m ped=${r.pedDist}m rail=${r.railDist}m curbOut=${r.curbOutside}(${r.curbOverhang}m) viol=${r.anyViol}`);
    }
    if (anyViols.length) {
      console.log(`\nAll violations (${anyViols.length}):`);
      for (const r of anyViols.slice(0, top)) {
        console.log(`  block ${r.srcBlockId} (${r.blockId}, ${r.district}) @ (${r.cx}, ${r.cz}) ${r.w}x${r.d}m road=${r.roadDist}m ped=${r.pedDist}m rail=${r.railDist}m curbOut=${r.curbOutside}(${r.curbOverhang}m)`);
      }
    }
    console.log(`\nClosest ${top} slabs to roadway:`);
    for (const r of closestRoad) {
      console.log(`  block ${r.srcBlockId} (${r.blockId}, ${r.district}) @ (${r.cx}, ${r.cz}) road=${r.roadDist}m`);
    }
    console.log(`\nClosest ${top} slabs to pedestrian corridor:`);
    for (const r of closestPed) {
      console.log(`  block ${r.srcBlockId} (${r.blockId}, ${r.district}) @ (${r.cx}, ${r.cz}) ped=${r.pedDist}m`);
    }
    console.log(`\nClosest ${top} slabs to rail/tram track:`);
    for (const r of closestRail) {
      console.log(`  block ${r.srcBlockId} (${r.blockId}, ${r.district}) @ (${r.cx}, ${r.cz}) rail=${r.railDist}m`);
    }
  }
}
