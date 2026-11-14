// Audit actual city-grid extrusion records against the existing 2.2875 m tram clearance corridor.
// node tools/audit-tram-bed-surfaces.mjs [--before] [--root PATH] [--json FILE] [--compare BEFORE.json] [--height]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const { THREE } = require('../tests/helpers/three-stub.cjs');
export function inert() {
  const values = {};
  return new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      return k in values ? values[k] : (values[k] = inert());
    },
    set(_t, k, v) { values[k] = v; return true; },
    apply: () => inert(), construct: () => inert()
  });
}
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const area = (p) => Math.abs(p.reduce((a, v, i) => {
  const q = p[(i + 1) % p.length];
  return a + v.x * q.z - q.x * v.z;
}, 0)) / 2;
// Independent Sutherland-Hodgman intersection; the production selector and subtraction are not called here.
function clip(poly, a, b) {
  const side = (p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], d = side(p), e = side(q);
    if (d >= 0) out.push(p);
    if ((d >= 0) !== (e >= 0)) out.push({ x: p.x + (q.x - p.x) * d / (d - e), z: p.z + (q.z - p.z) * d / (d - e) });
  }
  return out;
}
export async function audit(root, before = false, height = false) {
  const config = await import(pathToFileURL(join(root, 'js/city-config.js')));
  const { GEO } = await import(pathToFileURL(join(root, 'js/geodata.js')));
  let source = readFileSync(join(root, 'js/city-grid.js'), 'utf8');
  if (before) source = source.replace('const segs = tramSurfaceSegments(pts, holes);', 'const segs = [];');
  const records = [];
  let active, owner = 'site lawn';
  const entry = 'function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false, holes = []) {';
  const seam = '  const shape = createWorldXZShape(pts, holes);';
  if (!source.includes(entry) || !source.includes(seam)) throw Error('Extrusion audit seam changed');
  source = source.replace(entry, entry + '\n  beginSurface(pts, bottomY, height, holes);');
  source = source.replace('if (isParkBlock(b)) continue;', "if (isParkBlock(b)) continue; setSurfaceOwner('block ' + b.id);");
  source = source.replace('for (const s of UNDERPASS_SIDEWALKS || []) {',
    "for (const s of UNDERPASS_SIDEWALKS || []) { setSurfaceOwner('underpass sidewalk');");
  source = source.replace('if (!isParkBlock(b)) continue;', "if (!isParkBlock(b)) continue; setSurfaceOwner('park block ' + b.id);");
  source = source.replace("function addPavedPlaza(pts, style, topY = PLAZA_Y, holes = [], tramSegs = null, name = '', roads = []) {",
    "function addPavedPlaza(pts, style, topY = PLAZA_Y, holes = [], tramSegs = null, name = '', roads = []) { setSurfaceOwner('plaza ' + name);");

  source = source.replace('const PARK_TREE_EDGE = 10;', "setSurfaceOwner('partial block lawn'); const PARK_TREE_EDGE = 10;");
  source = source.replace(seam, '  emitSurface(pts, holes);\n' + seam);
  if (!source.includes('function triangulateSurface(')) {
    const current = readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
    source += '\n' + current.slice(current.indexOf('function triangulateSurface('), current.indexOf('// Final surface clipping'));
  }
  const stub = inert();
  const start = performance.now();
  const module = loadModule(source + '\nexport { triangulateSurface };', {
    imports: { 'three/webgpu': new Proxy(stub, { get: (t, k) => k === 'ShapeUtils' ? THREE.ShapeUtils : t[k] }), 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './city-config.js': config, './geodata.js': { GEO } },
    globals: { console: { info() {}, warn() {}, log() {} },
      setSurfaceOwner: (value) => { owner = value; },
      beginSurface: (poly, bottom, height, holes) => {
        const kind = bottom === 0.3 ? 'park lawn' : bottom === 0.2 && height < 0.12 ? 'partial lawn' :
          bottom === 0.2 ? 'park coping' : height === 0.55 ? 'median hedge' : bottom === 0.03 ? 'sidewalk' :
          height === 0.18 ? 'curb' : height < 0.23 ? 'park or plaza curb' : 'park or plaza paving';
        active = { kind, owner, bottom, height, poly, holes, pieces: [] };
        records.push(active);
      },
      emitSurface: (poly, holes) => active.pieces.push({ poly, holes }) }
  });
  const blocks = loadModule(readFileSync(join(root, 'js/buildings.js'), 'utf8'), {
    imports: { 'three/webgpu': stub, 'three/tsl': stub, 'three/addons/utils/BufferGeometryUtils.js': stub,
      './tsl-materials.js': stub, './balconies.js': stub, './roofs.js': stub,
      './city-config.js': config, './geodata.js': { GEO }, './city-grid.js': {
        pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [], railClearance: () => Infinity
      } }, globals: { document: stub, console: { info() {}, warn() {}, log() {} } }
  }).buildCityBlocks(stub);
  module.buildCityGrid(stub, { buildingFootprints: blocks.footprintsByBlock, buildingColliders: blocks.colliders });
  const buildMs = performance.now() - start;
  const half = 2.2875, corridors = [];
  for (const r of GEO.rail) if (r.kind === 'tram') {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const [ax, az, bx, bz] = r.pts.slice(i, i + 4), len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len * half, uz = (bz - az) / len * half;
      const poly = [{ x: ax - ux - uz, z: az - uz + ux }, { x: bx + ux - uz, z: bz + uz + ux },
        { x: bx + ux + uz, z: bz + uz - ux }, { x: ax - ux + uz, z: az - uz - ux }];
      poly.reverse();
      corridors.push({ poly, x0: Math.min(ax, bx) - half * 2, x1: Math.max(ax, bx) + half * 2,
        z0: Math.min(az, bz) - half * 2, z1: Math.max(az, bz) + half * 2 });
    }
  }
  const overlap = (poly, holes, localOnly = false) => {
    if (poly.length < 3) return false;
    const x0 = Math.min(...poly.map((p) => p.x)), x1 = Math.max(...poly.map((p) => p.x));
    const z0 = Math.min(...poly.map((p) => p.z)), z1 = Math.max(...poly.map((p) => p.z));
    const candidates = corridors.filter((c) => c.x0 < x1 && c.x1 > x0 && c.z0 < z1 && c.z1 > z0 &&
      (!localOnly || c.x0 < -960 && c.x1 > -1120 && c.z0 < -715 && c.z1 > -875));
    if (!candidates.length) return false;
    const tris = module.triangulateSurface(poly, holes);
    for (const c of candidates) for (const t of tris) {
      let p = t;
      for (let j = 0; j < 4 && p.length; j++) p = clip(p, c.poly[j], c.poly[(j + 1) % 4]);
      if (localOnly) {
        const box = [{ x: -1120, z: -875 }, { x: -960, z: -875 }, { x: -960, z: -715 }, { x: -1120, z: -715 }];
        for (let j = 0; j < 4 && p.length; j++) p = clip(p, box[j], box[(j + 1) % 4]);
      }
      if (p.length >= 3 && area(p) > 1e-6) return {
        x: p.reduce((a, v) => a + v.x, 0) / p.length,
        z: p.reduce((a, v) => a + v.z, 0) / p.length
      };
    }
    return false;
  };
  const summary = { records: records.length, pieces: 0, overlaps: 0, junctionOverlaps: 0, byKind: {}, buildMs };
  const rows = records.map((r) => {
    const location = overlap(r.poly, r.holes);
    const touch = !!location;
    const hits = r.pieces.filter((p) => overlap(p.poly, p.holes));
    const x = r.poly.reduce((a, p) => a + p.x, 0) / r.poly.length;
    const z = r.poly.reduce((a, p) => a + p.z, 0) / r.poly.length;
    const local = Math.min(...r.poly.map((p) => p.x)) < -960 && Math.max(...r.poly.map((p) => p.x)) > -1120 &&
      Math.min(...r.poly.map((p) => p.z)) < -715 && Math.max(...r.poly.map((p) => p.z)) > -875;
    const k = summary.byKind[r.kind] ||= { records: 0, touching: 0, overlapPieces: 0 };
    k.records++; k.touching += +touch; k.overlapPieces += hits.length;
    summary.pieces += r.pieces.length; summary.overlaps += hits.length;
    if (local) summary.junctionOverlaps += r.pieces.filter((p) => overlap(p.poly, p.holes, true)).length;
    return { kind: r.kind, owner: r.owner, x, z, location, local, touch, overlapPieces: hits.length, input: hash([r.poly, r.holes, r.bottom, r.height]),
      output: hash(r.pieces), areaBefore: module.triangulateSurface(r.poly, r.holes).reduce((a, t) => a + area(t), 0),
      areaAfter: r.pieces.reduce((a, p) => a + module.triangulateSurface(p.poly, p.holes).reduce((b, t) => b + area(t), 0), 0) };
  });
  let heightAgreement;
  if (height) {
    const cell = 32, grid = new Map();
    const inside = (poly, x, z) => {
      let yes = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) yes = !yes;
      }
      return yes;
    };
    for (const r of records) for (const piece of r.pieces) {
      const p = piece.poly;
      const x0 = Math.min(...p.map((v) => v.x)), x1 = Math.max(...p.map((v) => v.x));
      const z0 = Math.min(...p.map((v) => v.z)), z1 = Math.max(...p.map((v) => v.z));
      for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
        for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
          const key = ix * 100003 + iz;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(piece);
        }
      }
    }
    const blockGrid = new Map();
    for (const b of [...config.BLOCKS, ...config.UNDERPASS_SIDEWALKS]) {
      for (let ix = Math.floor(b.minX / cell); ix <= Math.floor(b.maxX / cell); ix++) {
        for (let iz = Math.floor(b.minZ / cell); iz <= Math.floor(b.maxZ / cell); iz++) {
          const key = ix * 100003 + iz;
          if (!blockGrid.has(key)) blockGrid.set(key, []);
          blockGrid.get(key).push(b);
        }
      }
    }
    heightAgreement = { samples: 0, mismatches: 0, logicalRaised: 0, renderedRaised: 0,
      predicateChecks: 0, predicateMismatches: 0, examples: [] };
    for (const rail of GEO.rail) if (rail.kind === 'tram') {
      for (let i = 0; i + 3 < rail.pts.length; i += 2) {
        const [ax, az, bx, bz] = rail.pts.slice(i, i + 4), len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        // Include both extended end caps and five lateral lines, 1 cm inside the cut boundary.
        const count = Math.ceil(len + 2 * half - 0.02);
        for (let n = 0; n <= count; n++) {
          const along = -half + 0.01 + n / count * (len + 2 * half - 0.02);
          for (const across of [-half + 0.01, -half / 2, 0, half / 2, half - 0.01]) {
            const x = ax + ux * along - uz * across, z = az + uz * along + ux * across;
            const logical = config.blockAt(x, z);
            const pieces = grid.get(Math.floor(x / cell) * 100003 + Math.floor(z / cell)) || [];
            const rendered = pieces.some((p) => inside(p.poly, x, z) && !p.holes.some((h) => inside(h, x, z)));
            if (config.isBlockAt) {
              const candidates = blockGrid.get(Math.floor(x / cell) * 100003 + Math.floor(z / cell)) || [];
              for (const b of [null, ...candidates]) {
                heightAgreement.predicateChecks++;
                if (config.isBlockAt(x, z, b) !== (logical === b)) heightAgreement.predicateMismatches++;
              }
            }
            heightAgreement.samples++;
            heightAgreement.logicalRaised += +!!logical;
            heightAgreement.renderedRaised += +rendered;
            if (!!logical !== rendered) {
              heightAgreement.mismatches++;
              if (heightAgreement.examples.length < 30) heightAgreement.examples.push({ x, z, block: logical?.id, rendered });
            }
          }
        }
      }
    }
  }
  return { summary, rows, heightAgreement };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : null;
  const result = await audit(resolve(option('--root') || '.'), args.includes('--before'), args.includes('--height'));
  if (option('--compare')) {
    const before = JSON.parse(readFileSync(option('--compare'), 'utf8'));
    if (before.rows.length !== result.rows.length) throw Error('Surface request count changed');
    const changes = result.rows.filter((r, i) => r.output !== before.rows[i].output);
    const untouched = result.rows.filter((r, i) => r.output === before.rows[i].output);
    result.diff = {
      changed: changes.length, unchanged: untouched.length,
      changedWithoutTouch: changes.filter((r) => !r.touch).length,
      inputChanges: result.rows.filter((r, i) => r.input !== before.rows[i].input).length,
      unchangedHash: hash(untouched.map((r) => [r.input, r.output])),
      byKind: Object.fromEntries([...new Set(changes.map((r) => r.kind))].map((kind) =>
        [kind, changes.filter((r) => r.kind === kind).length])),
      samples: changes.filter((r) => r.local).map((r) => ({ kind: r.kind, owner: r.owner,
        location: r.location, areaBefore: r.areaBefore, areaAfter: r.areaAfter }))
    };
    console.log(JSON.stringify(result.diff, null, 2));
  }
  if (option('--json')) writeFileSync(option('--json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.heightAgreement) console.log(JSON.stringify(result.heightAgreement, null, 2));
  console.log(JSON.stringify(result.rows.filter((r) => r.touch).slice(0, 12), null, 2));
}
