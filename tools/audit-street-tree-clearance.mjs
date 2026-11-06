// Real grid, buildings, furniture, finished lanes and pedestrian crossings; inert rendering only.
// Default matches street-tree-colliders.test.cjs; --full adds landmarks, bridges and building-cut park surfaces.
// Timings measure buildStreetDetails with inert rendering; --full also includes street/road VM compilation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runAudit as buildFullWorld } from './audit-tree-clearance.mjs';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { loadModule } = require('../tests/helpers/module.cjs');
const source = (name) => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
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
    apply: () => inert(), construct: () => inert()
  });
}
export async function runAudit({ streetSource = source('street-details'), full = false, buildingObstacles = true, buildings = true, reuseNetwork = true } = {}) {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const stub = inert();
  const rendering = { 'three/webgpu': stub, 'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub, './tsl-materials.js': stub };
  let clearOfCrosswalks, sites;
  const movedSites = [];
  const capture = (check, moved) => {
    if (check) clearOfCrosswalks = check;
    if (moved) movedSites.push(moved);
  };
  const globals = { document: stub, console: { info() {}, warn() {}, log() {} },
    capture };
  const load = (name, imports, extra = '', code = source(name)) => loadModule(code + extra, { imports, globals });
  const road = load('road-network', { './city-config.js': config, './geodata.js': { GEO } });
  let gridModule, grid, details, buildMs, buildingColliders;
  const instrumented = streetSource.replace('const TREE_SP = 15;',
    'capture(clearOfCrosswalks);\n  const TREE_SP = 15;')
    .replace('treePlacement.moved++;', 'treePlacement.moved++; capture(null, { x, z });');
  if (full) {
    const world = await buildFullWorld({ worldOnly: true, streetSource: instrumented,
      capture });
    ({ gridModule, grid, details, buildMs, buildingColliders, sites } = world);
  } else {
    gridModule = load('city-grid', { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
      '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }');
    grid = gridModule.buildCityGrid(stub);
    const liveGrid = { ...gridModule, ...gridModule.snapshot() };
    const bld = buildings ? load('buildings', { ...rendering, './balconies.js': stub, './roofs.js': stub,
      './city-config.js': config, './geodata.js': { GEO }, './city-grid.js': liveGrid }).buildCityBlocks(stub) : { colliders: [] };
    const street = load('street-details', { ...rendering, './city-config.js': config,
      './road-network.js': road, './city-grid.js': liveGrid,
      './trees.js': { createTreeField: (_scene, trees) => { sites = trees; return { group: stub }; } } }, '',
      instrumented);
    const start = performance.now();
    details = street.buildStreetDetails(stub, { buildingColliders: bld.colliders, grid });
    buildMs = performance.now() - start;

    buildingColliders = bld.colliders;
  }
  const network = reuseNetwork && buildingObstacles && details.roadNetwork || road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...details.footprints,
    ...(buildingObstacles ? buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5) : [])]);
  const routes = load('pedestrian-routes', { './road-network.js': road })
    .createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  return auditStreetTrees({ sites, network, routes, config, clearOfCrosswalks, grid, details, movedSites, buildMs });
}

// Pure measurement shared with the distribution fixture: no second world build in the regression suite.
export function auditStreetTrees({ sites, network, routes, config, clearOfCrosswalks, grid, details,
  movedSites = [], buildMs = 0 }) {
  const trees = sites.filter((t) => t.tier === 2 || t.tier === 1 && t.pitRot !== undefined);
  const distance = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - ax - u * dx, z - az - u * dz);
  };
  const lanes = network.edges.flatMap((e) => e.lanes.map((l) => ({ ax: e.x0 + e.rx * l,
    az: e.z0 + e.rz * l, bx: e.x0 + e.dx * e.span + e.rx * l, bz: e.z0 + e.dz * e.span + e.rz * l })));
  const index = (segments, pad) => {
    const cells = new Map();
    for (const s of segments) {
      for (let x = Math.floor((Math.min(s.ax, s.bx) - pad) / 32); x <= Math.floor((Math.max(s.ax, s.bx) + pad) / 32); x++) {
        for (let z = Math.floor((Math.min(s.az, s.bz) - pad) / 32); z <= Math.floor((Math.max(s.az, s.bz) + pad) / 32); z++) {
          const key = `${x},${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(s);
        }
      }
    }
    return (t) => cells.get(`${Math.floor(t.x / 32)},${Math.floor(t.z / 32)}`) || [];
  };
  const nearbyLanes = index(lanes, 2), nearbyZebras = index(routes.crosswalks, 3);
  const violations = { landing: [], zebra: [], lane: [], island: [] };
  let minLane = Infinity;
  for (const t of trees) {
    const r = 0.28 * t.scale;
    if (!clearOfCrosswalks(t.x, t.z, r)) violations.landing.push(t);
    // The whole zebra band includes stripe gaps and rail cuts: a conservative painted-area check.
    if (nearbyZebras(t).some((c) => {
      const dx = c.bx - c.ax, dz = c.bz - c.az, len = Math.hypot(dx, dz);
      const along = ((t.x - c.ax) * dx + (t.z - c.az) * dz) / len;
      const side = Math.abs((t.x - c.ax) * dz - (t.z - c.az) * dx) / len;
      const pad = r * (Math.abs(dx) + Math.abs(dz)) / len;
      return along > -pad && along < len + pad && side < 2 + pad;
    })) violations.zebra.push(t);
    let nearest = Infinity;
    for (const l of nearbyLanes(t)) {
      if (t.x < Math.min(l.ax, l.bx) - 2 || t.x > Math.max(l.ax, l.bx) + 2 ||
          t.z < Math.min(l.az, l.bz) - 2 || t.z > Math.max(l.az, l.bz) + 2) continue;
      nearest = Math.min(nearest, distance(t.x, t.z, l.ax, l.az, l.bx, l.bz));
    }
    minLane = Math.min(minLane, nearest);
    if (nearest < Math.max(1.2, 0.9 + r * Math.SQRT2)) violations.lane.push(t);
    const b = config.blockAt(t.x, t.z);
    if (!b || [-r, r].some((dx) => [-r, r].some((dz) => config.blockAt(t.x + dx, t.z + dz) !== b))) {
      violations.island.push(t);
    }
  }
  const cells = new Map();
  for (const t of trees) {
    const key = `${Math.floor(t.x / 4)},${Math.floor(t.z / 4)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  const movedKeys = new Set(movedSites.map((t) => `${t.x},${t.z}`));
  let minTreeDistance = Infinity, minMovedTreeDistance = Infinity;
  for (const t of trees) {
    const ix = Math.floor(t.x / 4), iz = Math.floor(t.z / 4);
    for (let x = ix - 1; x <= ix + 1; x++) for (let z = iz - 1; z <= iz + 1; z++) {
      for (const other of cells.get(`${x},${z}`) || []) if (t !== other) {
        const distance = Math.hypot(t.x - other.x, t.z - other.z);
        minTreeDistance = Math.min(minTreeDistance, distance);
        if (movedKeys.has(`${t.x},${t.z}`)) minMovedTreeDistance = Math.min(minMovedTreeDistance, distance);
      }
    }
  }
  const counts = Object.fromEntries(Object.entries(violations).map(([k, v]) => [k, v.length]));
  const treeSet = new Set(trees);
  const parkTrees = sites.filter((t) => !treeSet.has(t));
  const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return { parkHash: digest(parkTrees), footprintHash: digest([grid.footprints, details.footprints]), counts,
    streetTrees: trees.length, totalTrees: sites.length, minLane, minTreeDistance, minMovedTreeDistance, buildMs,
    networkNodes: network.nodes.length, networkEdges: network.edges.length,
    crosswalks: routes.crosswalks.length, placement: details.treePlacement, trees, parkTrees, violations };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { trees, parkTrees, violations, ...report } = await runAudit({ full: process.argv.includes('--full'), reuseNetwork: !process.argv.includes('--rebuild-network') });
  console.log(JSON.stringify(report, null, 2));
}
