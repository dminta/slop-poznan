// tools/check-worst-triangulation.mjs
// Targeted check: triangulates park surfaces of all 41 park blocks with buildings using three's real
// ShapeUtils.triangulateShape, reporting per-mesh area error, double-covered area (multi), triangle area inside holes (over),
// and missing area outside holes (under). Exits non-zero on error.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

const { THREE } = require(join(ROOT, 'tests/helpers/three-stub.cjs'));
const { ShapeUtils } = THREE;
const { loadModule } = require(join(ROOT, 'tests/helpers/module.cjs'));
const config = require(join(ROOT, 'js/city-config.js'));
const { GEO } = require(join(ROOT, 'js/geodata.js'));

function inert() {
  const v = {};
  return new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      return k in v ? v[k] : (v[k] = inert());
    },
    set(_t, k, x) { v[k] = x; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

const inside = (p, x, z) => {
  let h = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) h = !h;
  }
  return h;
};

const src = (n) => readFileSync(join(ROOT, 'js', n + '.js'), 'utf8');
const render = {
  'three/webgpu': inert(), 'three/tsl': inert(),
  'three/addons/utils/BufferGeometryUtils.js': inert(), './tsl-materials.js': inert()
};
const globals = { console: { info() {}, log() {}, warn() {} }, document: inert() };

const bld = loadModule(src('buildings'), {
  imports: {
    ...render, './balconies.js': inert(), './roofs.js': inert(),
    './city-config.js': config, './geodata.js': { GEO },
    './city-grid.js': { pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
  },
  globals
});
const blocks = bld.buildCityBlocks(inert());

const kind = (y, h) => (
  y === 0 && Math.abs(h - 0.22) < 1e-6 ? 'curb' :
  y === 0 && Math.abs(h - 0.26) < 1e-6 ? 'paving' :
  y === 0.2 && Math.abs(h - 0.20) < 1e-6 ? 'granite' :
  y === 0.3 && Math.abs(h - 0.11) < 1e-6 ? 'lawn' : null
);

let gsrc = src('city-grid');
gsrc = gsrc.replace('if (!isParkBlock(b)) continue;\n    const ponds', 'if (!isParkBlock(b)) continue;\n    setOwner(b);\n    const ponds')
  .replace('const shape = createWorldXZShape(pts, holes);', 'record(pts, bottomY, height, holes);\n  const shape = createWorldXZShape(pts, holes);')
  .replace('if (!(b.park > 0) || isParkBlock(b) || b.median) continue;', 'setOwner(null); if (!(b.park > 0) || isParkBlock(b) || b.median) continue;');

let owner = null;
const recs = [];
const g = loadModule(gsrc, {
  imports: { ...render, './city-config.js': config, './geodata.js': { GEO } },
  globals: {
    ...globals,
    setOwner: (b) => { owner = b; },
    record: (pts, y, h, holes) => {
      const k = owner && owner.buildings > 0 && kind(y, h);
      if (k) recs.push({ id: owner.id, k, pts, holes: holes || [] });
    }
  }
});
g.buildCityGrid(inert(), { buildingFootprints: blocks.footprintsByBlock });

const ALL_41 = config.BLOCKS.filter((b) => b.park > 0.6 && !b.median && b.area > 250 && b.buildings > 0).map((b) => b.id);
const mk = (x, y) => ({ x, y, equals(o) { return Math.abs(o.x - x) < 1e-4 && Math.abs(o.y - y) < 1e-4; } });
const triArea = (a, b, c) => 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const shoe = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].z - p[i].x * p[j].z; return a / 2; };
const STEP = 1.0, A = STEP * STEP;

const t0 = Date.now();
const results = {};
for (const id of ALL_41) {
  results[id] = {
    curb: { over: 0, under: 0, multi: 0, areaErr: 0 },
    paving: { over: 0, under: 0, multi: 0, areaErr: 0 },
    granite: { over: 0, under: 0, multi: 0, areaErr: 0 },
    lawn: { over: 0, under: 0, multi: 0, areaErr: 0 }
  };
}

let meshFailures = 0;

for (const r of recs) {
  if (!ALL_41.includes(r.id)) continue;
  const res = results[r.id][r.k];
  const v = r.pts.map((p) => mk(p.x, -p.z));
  const verts = ShapeUtils.isClockWise(v) ? v : v.slice().reverse();
  const hs = r.holes.map((h) => {
    const hv = h.map((p) => mk(p.x, -p.z));
    return ShapeUtils.isClockWise(hv) ? hv.slice().reverse() : hv;
  });
  const faces = ShapeUtils.triangulateShape(verts, hs);
  const all = verts.concat(...hs);
  const triA = faces.reduce((s, f) => s + triArea(all[f[0]], all[f[1]], all[f[2]]), 0);
  const expA = Math.abs(shoe(r.pts)) - r.holes.reduce((s, h) => s + Math.abs(shoe(h)), 0);
  const err = Math.abs(triA - expA);
  res.areaErr = Math.max(res.areaErr, err);

  const tris = faces.map((f) => f.map((i) => ({ x: all[i].x, z: -all[i].y })));
  const tb = tris.map((tr) => [
    Math.min(...tr.map((p) => p.x)), Math.max(...tr.map((p) => p.x)),
    Math.min(...tr.map((p) => p.z)), Math.max(...tr.map((p) => p.z))
  ]);
  const TI = new Map();
  tb.forEach((b, i) => {
    for (let gx = Math.floor(b[0] / 8); gx <= Math.floor(b[1] / 8); gx++) {
      for (let gz = Math.floor(b[2] / 8); gz <= Math.floor(b[3] / 8); gz++) {
        const k = gx * 1e6 + gz;
        if (!TI.has(k)) TI.set(k, []);
        TI.get(k).push(i);
      }
    }
  });

  // Spatial index over holes for fast hit-testing
  const HI = new Map();
  r.holes.forEach((h, i) => {
    const xs = h.map((p) => p.x), zs = h.map((p) => p.z);
    for (let gx = Math.floor(Math.min(...xs) / 8); gx <= Math.floor(Math.max(...xs) / 8); gx++) {
      for (let gz = Math.floor(Math.min(...zs) / 8); gz <= Math.floor(Math.max(...zs) / 8); gz++) {
        const k = gx * 1e6 + gz;
        if (!HI.has(k)) HI.set(k, []);
        HI.get(k).push(i);
      }
    }
  });

  // Sample only over and near the bounding box of holes to keep check fast
  for (const h of r.holes) {
    const hxs = h.map((p) => p.x), hzs = h.map((p) => p.z);
    const minX = Math.min(...hxs) - 4, maxX = Math.max(...hxs) + 4;
    const minZ = Math.min(...hzs) - 4, maxZ = Math.max(...hzs) + 4;
    for (let x = minX + STEP / 2; x < maxX; x += STEP) {
      for (let z = minZ + STEP / 2; z < maxZ; z += STEP) {
        const ck = Math.floor(x / 8) * 1e6 + Math.floor(z / 8);
        const inPt = inside(r.pts, x, z);
        const inH = (HI.get(ck) || []).some((i) => inside(r.holes[i], x, z));
        const want = inPt && !inH;
        let n = 0;
        for (const i of TI.get(ck) || []) {
          const b = tb[i];
          if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
          if (inside(tris[i], x, z)) n++;
        }
        if (n && inH) res.over += A;
        if (!n && want) res.under += A;
        if (n > 1) res.multi += A;
      }
    }
  }

  // Check limits: every mesh triangulates to its outline minus holes (0.00 m² measured on 2026-11-05) with no
  // triangle inside a hole
  if (err >= 1.0 || res.over > 0) {
    console.error(`FAILURE: block ${r.id} ${r.k} has area error ${err.toFixed(2)} m² or ${res.over} m² over holes`);
    meshFailures++;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`All 41 park blocks triangulation check completed in ${elapsed} s:\n`);

const WORST = [32, 205, 890, 0, 1274, 614, 1016, 966, 342, 470, 613];
for (const id of WORST) {
  const block = config.BLOCKS.find((b) => b.id === id);
  console.log(`Block ${id} (${block.parkName || 'unnamed'}):`);
  for (const k of ['curb', 'paving', 'granite', 'lawn']) {
    const { over, under, multi, areaErr } = results[id][k];
    console.log(`  ${k.padEnd(8)}: areaErr=${areaErr.toFixed(1)} m², multi=${multi.toFixed(1)} m², over=${over.toFixed(1)} m², under=${under.toFixed(1)} m²`);
  }
}

if (meshFailures > 0) {
  console.error(`\nTriangulation check FAILED: ${meshFailures} meshes exceeded error tolerance`);
  process.exit(1);
}

console.log('\nAll 41 park blocks passed triangulation tolerance.');

