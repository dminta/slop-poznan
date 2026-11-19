// Pole-vs-outskirts-building clearance audit.
// The tram catenary and signal poles around the data edge stand outside the detail box, where outskirts.js generates
// buildings. Those buildings keep only 1.5 m off a tram track (railRectClear), while a catenary pole can stand 2.6-16 m
// from it (tram-infra.js march), so a pole can land inside an outskirts house or panel block. This tool builds the same
// furnished headless world as tools/audit-balcony-spans.mjs, generates the real outskirts building list (private
// generators exported through a source suffix), and measures every pole near the edge against those oriented boxes.
// Clearance is the horizontal gap from the pole surface to the building footprint; a negative value is a penetration
// of that depth. Rows below --margin (default 0.3 m, the balcony audit's threshold) are clashes.
//
// Usage: node tools/audit-pole-outskirts.mjs [--margin 0.3] [--band 300] [--near 60] [--top 12] [--json]
//   --band  metres inside the detail box within which street-details poles/lamp masts are checked (0 = outside only)
//   --near  search radius for the reported nearest building; a pole with none within it reports null
//   --fail-on-clash  exit 1 when a clash remains (off by default: the 2026-11-19 run reports the open decision)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(join(root, 'js', name + '.js'), 'utf8');

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MARGIN = Number(argValue('--margin', '0.3'));
const BAND = Number(argValue('--band', '300'));
const NEAR = Number(argValue('--near', '60'));
const TOP = Number(argValue('--top', '12'));
const CELL = 64;

function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

// The headless world fixture (city grid, buildings, street furniture, tram layout) from the balcony audit.
const { runAudit } = await import('./audit-tree-clearance.mjs');
const savedLog = console.log;
console.log = () => {};
const world = await runAudit({ worldOnly: true });
const { config, GEO, grid, gridModule, details: street, roadMod: road, tramMod } = world;
const network = road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints,
  ...world.buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)]);
const tramLayout = tramMod.layoutTramInfrastructure(network, grid);
const railLayout = tramMod.layoutRailInfrastructure(network);

// Outskirts buildings: the two private generators feed buildOutskirts; export them rather than replicating the zone
// grids. railRectClear is the live city-grid predicate, so on-track buildings are filtered exactly as in the app.
const stub = inert();
const satellites = await import('../js/satellite-sites.js');
let outskirtSrc = source('outskirts');
outskirtSrc += '\nexport function auditBuildings() { const { list } = generateOutskirtsBuildings(); ' +
  'for (const b of buildSatelliteSiteBuildings()) list.push(b); return list; }\n';
const outskirts = loadModule(outskirtSrc, {
  imports: {
    'three/webgpu': stub,
    'three/tsl': stub,
    './tsl-materials.js': stub,
    './city-config.js': config,
    './satellite-sites.js': satellites,
    './city-grid.js': { railRectClear: gridModule.railRectClear }
  },
  globals: { console: { info() {}, warn() {}, log() {} }, Math, Object, Array, Set, Map, Number, Infinity, JSON,
    Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Promise, String, Error,
    document: stub },
  filename: 'outskirts.js'
});
const buildings = outskirts.auditBuildings();
console.log = savedLog;

// Name the hand-placed satellite parts for the report; generated borough blocks have no name.
const satelliteName = (b) => {
  for (const site of satellites.SATELLITE_SITES) {
    for (const p of site.parts) {
      if (Math.abs(p.x - b.x) < 0.01 && Math.abs(p.z - b.z) < 0.01 &&
        Math.abs(p.w - b.w) < 0.01 && Math.abs(p.d - b.d) < 0.01) return `${site.name} part`;
    }
  }
  return null;
};

const [BX0, BX1, BZ0, BZ1] = GEO.frame.detailBox;
const outside = (x, z) => x <= BX0 || x >= BX1 || z <= BZ0 || z >= BZ1;
const inwardDist = (x, z) => Math.min(x - BX0, BX1 - x, z - BZ0, BZ1 - z);
const inBand = (x, z, band = BAND) => outside(x, z) || inwardDist(x, z) <= band;

// Poles: every tram catenary pole and railway mast, plus the street-details signal poles and lamp/column masts outside
// the detail box or within --band m inside its edge. Heights come from the renderers (tram poles 7.0-7.6 m, signal
// pole 4.2 m, LED mast 6 m, gas lantern 4.45 m, advertising column 4 m); a pole only clashes with a building box whose
// vertical span it meets.
const poles = [];
for (const q of tramLayout.poles) {
  poles.push({ cls: 'tram', label: 'tram catenary pole', x: q.x, z: q.z, r: 0.16, y0: 0, y1: q.h });
}
for (const q of railLayout.masts) {
  poles.push({ cls: 'rail', label: 'railway mast', x: q.x, z: q.z, r: q.h > 9 ? 0.225 : 0.15, y0: 0, y1: q.h });
}
const STREET_HEIGHT = { signal: 4.2, led: 6, gas: 4.45, column: 4 };
for (const f of street.footprints) {
  const height = STREET_HEIGHT[f.kind];
  if (height === undefined) continue;
  const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2;
  if (!inBand(x, z)) continue;
  const label = f.kind === 'signal' ? 'signal pole' : (f.kind === 'led' ? 'street LED mast'
    : (f.kind === 'gas' ? 'gas lantern mast' : 'advertising column'));
  poles.push({ cls: f.kind === 'signal' ? 'signal' : 'lamp', label, x, z,
    r: Math.max(f.maxX - f.minX, f.maxZ - f.minZ) / 2, y0: 0, y1: height });
}

// 64 m bucket grid over the building boxes, padded by the box radius.
const cells = new Map();
const cellKey = (ix, iz) => ix * 100003 + iz;
const buildingRadius = buildings.map((b) => Math.hypot(b.w, b.d) / 2);
for (let i = 0; i < buildings.length; i++) {
  const b = buildings[i];
  const r = buildingRadius[i];
  for (let ix = Math.floor((b.x - r) / CELL); ix <= Math.floor((b.x + r) / CELL); ix++) {
    for (let iz = Math.floor((b.z - r) / CELL); iz <= Math.floor((b.z + r) / CELL); iz++) {
      const k = cellKey(ix, iz);
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
  }
}

// Signed horizontal distance from a point to a turned building footprint (negative inside, to the nearest face).
function pointBoxGap(px, pz, b) {
  const dx = px - b.x, dz = pz - b.z;
  const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
  const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
  const hx = b.w / 2, hz = b.d / 2;
  if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) return -Math.min(hx - Math.abs(lx), hz - Math.abs(lz));
  return Math.hypot(Math.max(Math.abs(lx) - hx, 0), Math.max(Math.abs(lz) - hz, 0));
}

const nearest = {};
const nearestAll = { gap: Infinity };
const clashes = [];
const distribution = { inside: 0, under03: 0, m03to1: 0, m1to3: 0, m3to10: 0, over10: 0, none: 0 };
const reach = Math.ceil((NEAR + 8) / CELL);
for (const p of poles) {
  let best = null;
  const ix = Math.floor(p.x / CELL), iz = Math.floor(p.z / CELL);
  const seen = new Set();
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (const i of cells.get(cellKey(ix + dx, iz + dz)) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const b = buildings[i];
        if (b.y > p.y1 + MARGIN || b.y + b.h < p.y0 - MARGIN) continue;
        const gap = pointBoxGap(p.x, p.z, b) - p.r;
        if (!best || gap < best.gap) best = { gap, building: b };
      }
    }
  }
  if (!best || best.gap > NEAR) { distribution.none++; continue; }
  if (best.gap < 0) distribution.inside++;
  else if (best.gap < 0.3) distribution.under03++;
  else if (best.gap < 1) distribution.m03to1++;
  else if (best.gap < 3) distribution.m1to3++;
  else if (best.gap < 10) distribution.m3to10++;
  else distribution.over10++;
  if (!nearest[p.cls] || best.gap < nearest[p.cls].gap) nearest[p.cls] = { ...best, pole: p };
  if (best.gap < nearestAll.gap) nearestAll.gap = best.gap, nearestAll.best = { ...best, pole: p };
  if (best.gap < MARGIN) clashes.push({ gap: best.gap, pole: p, building: best.building });
}
clashes.sort((a, b) => a.gap - b.gap || a.pole.cls.localeCompare(b.pole.cls) ||
  (a.pole.x - b.pole.x) || (a.pole.z - b.pole.z));

const round = (v) => Math.round(v * 1000) / 1000;
const where = (b) => {
  const name = satelliteName(b);
  return { x: round(b.x), z: round(b.z), w: round(b.w), d: round(b.d), h: round(b.h), rot: round(b.rot),
    base: round(b.y), satellite: b.onRail === undefined, name, insideBox: !outside(b.x, b.z) };
};
const nearestRow = (n) => n && n.gap <= NEAR ? {
  gap: round(n.gap), pole: { class: n.pole.cls, x: round(n.pole.x), z: round(n.pole.z), h: round(n.pole.y1) },
  building: where(n.building)
} : null;
const byClass = {};
const outsideByClass = {};
for (const p of poles) {
  byClass[p.cls] = (byClass[p.cls] || 0) + 1;
  if (outside(p.x, p.z)) outsideByClass[p.cls] = (outsideByClass[p.cls] || 0) + 1;
}
for (const cls of Object.keys(byClass)) outsideByClass[cls] = outsideByClass[cls] || 0;
const clashByClass = {};
for (const c of clashes) clashByClass[c.pole.cls] = (clashByClass[c.pole.cls] || 0) + 1;

const summary = {
  margin: MARGIN,
  band: BAND,
  nearQuery: NEAR,
  detailBox: [BX0, BX1, BZ0, BZ1],
  poles: { total: poles.length, byClass, outsideBox: outsideByClass },
  buildings: { total: buildings.length, satelliteParts: buildings.filter((b) => b.onRail === undefined).length,
    generated: buildings.filter((b) => b.onRail !== undefined).length },
  distribution,
  clashes: clashes.length,
  clashByClass,
  deepestPenetration: clashes.length ? round(-clashes[0].gap) : 0,
  nearest: Object.fromEntries(['tram', 'rail', 'signal', 'lamp'].map((c) => [c, nearestRow(nearest[c])])),
  closest: nearestRow(nearestAll.best),
  worst: clashes.slice(0, TOP).map((c) => ({
    gap: round(c.gap), penetration: round(-c.gap), class: c.pole.cls, label: c.pole.label,
    pole: { x: round(c.pole.x), z: round(c.pole.z), h: round(c.pole.y1), radius: round(c.pole.r) },
    outsideBox: outside(c.pole.x, c.pole.z),
    building: where(c.building)
  }))
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary));
} else {
  for (const row of summary.worst) {
    const b = row.building;
    const name = b.name ? ` (${b.name})` : '';
    console.log(`${row.penetration > 0 ? 'INSIDE' : 'NEAR'} ${row.penetration > 0
      ? `${row.penetration.toFixed(3)} m deep`
      : `${(-row.gap).toFixed(3)} m clear`}: ${row.label} at (${row.pole.x.toFixed(1)}, ${row.pole.z.toFixed(1)})` +
      `${row.outsideBox ? ' outside the box' : ''} vs ${b.satellite ? 'satellite' : 'generated'} building` +
      `${name} (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) ${b.w.toFixed(1)} x ${b.d.toFixed(1)} m, h ${b.h.toFixed(1)}`);
  }
  console.log(JSON.stringify(summary));
}
if (process.argv.includes('--fail-on-clash') && clashes.length) process.exit(1);
