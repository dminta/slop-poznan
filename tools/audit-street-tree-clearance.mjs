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
export async function runAudit({ streetSource = source('street-details'), full = false, osm = false, buildingObstacles = true, buildings = true, reuseNetwork = true } = {}) {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/geodata.js');
  const stub = inert();
  let clearOfCrosswalks, sites;
  const helpers = {};
  const movedSites = [];
  const capture = (check, moved, extra) => {
    if (check) clearOfCrosswalks = check;
    if (moved) movedSites.push(moved);
    if (extra) Object.assign(helpers, extra);
  };
  const globals = { document: stub, console: { info() {}, warn() {}, log() {} },
    capture };
  const rendering = { 'three/webgpu': stub, 'three/tsl': stub,
    'three/addons/utils/BufferGeometryUtils.js': stub, './tsl-materials.js': stub };
  const load = (name, imports, extra = '', code = source(name)) => loadModule(code + extra, { imports, globals });
  const road = load('road-network', { './city-config.js': config, './geodata.js': { GEO } });
  let gridModule, grid, details, buildMs, buildingColliders, tram, tramLayout;
  const instrumented = streetSource.replace('const TREE_SP = 15;',
    'capture(clearOfCrosswalks, null, { clearOfCrosswalks, isClearOfPoles, clearOfOsmPoleOverlap, clearOfTramPoles, inPlaza, isClearOfWalls, nearPlanter, onPromenade, clearStreetTree, clearOfRails, roadClearance, treeBlockAt });\n  const TREE_SP = 15;')
    .replace('treePlacement.moved++;', 'treePlacement.moved++; capture(null, { x, z });');
  if (full) {
    const world = await buildFullWorld({ worldOnly: true, streetSource: instrumented,
      capture });
    ({ gridModule, grid, details, buildMs, buildingColliders, sites } = world);
    tram = load('tram-infra', { ...rendering, './city-config.js': config, './geodata.js': { GEO },
      './road-network.js': road, './city-grid.js': gridModule });
  } else {
    gridModule = load('city-grid', { ...rendering, './city-config.js': config, './geodata.js': { GEO } },
      '\nexport function snapshot() { return { pavedPlazaRects, parkTreeSites, parkLampSites, sidewalkBlocks }; }');
    grid = gridModule.buildCityGrid(stub);
    const liveGrid = { ...gridModule, ...gridModule.snapshot() };
    const bld = buildings ? load('buildings', { ...rendering, './balconies.js': stub, './roofs.js': stub,
      './city-config.js': config, './geodata.js': { GEO }, './city-grid.js': liveGrid }).buildCityBlocks(stub) : { colliders: [] };
    tram = load('tram-infra', { ...rendering, './city-config.js': config, './geodata.js': { GEO },
      './road-network.js': road, './city-grid.js': liveGrid });
    const street = load('street-details', { ...rendering, './city-config.js': config,
      './road-network.js': road, './city-grid.js': liveGrid,
      './trees.js': { createTreeField: (_scene, trees) => { sites = trees; return { group: stub }; } } }, '',
      instrumented);
    const start = performance.now();
    details = street.buildStreetDetails(stub, { buildingColliders: bld.colliders, grid, layoutTramInfrastructure: tram.layoutTramInfrastructure });
    buildMs = performance.now() - start;

    buildingColliders = bld.colliders;
  }
  const network = reuseNetwork && buildingObstacles && details.roadNetwork || road.buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...details.footprints,
    ...(buildingObstacles ? buildingColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5) : [])]);
  const routes = load('pedestrian-routes', { './road-network.js': road })
    .createPedestrianRoutes(network, config.blockAt, gridModule.railClearance);
  tramLayout = details.tramLayout && reuseNetwork && buildingObstacles ? details.tramLayout : tram.layoutTramInfrastructure(network);
  const result = auditStreetTrees({ sites, network, routes, config, clearOfCrosswalks, grid, details, movedSites, buildMs,
    helpers, tram, tramLayout });
  if (osm) result.osmReport = auditOsmWindows({ sites, trees: result.trees, config, helpers });
  return result;
}

// Pure measurement shared with the distribution fixture: no second world build in the regression suite.
export function auditStreetTrees({ sites, network, routes, config, clearOfCrosswalks, grid, details,
  movedSites = [], buildMs = 0, helpers = null, tram = null, tramLayout = null }) {
  const trees = sites.filter((t) => t.tier === 2 || t.tier === 1 && t.pitRot !== undefined);
  const distance = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    if (l2 === 0) return Math.hypot(x - ax, z - az);
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(x - ax - u * dx, z - az - u * dz);
  };
  const laneShift = network.laneShiftAt || (() => 0);
  const lanes = network.edges.flatMap((e) => e.lanes.flatMap((l) => {
    const steps = e.laneShift ? Math.max(1, Math.ceil(e.span / 8)) : 1;
    const segs = [];
    let ax = e.x0 + e.rx * (l + laneShift(e, 0)), az = e.z0 + e.rz * (l + laneShift(e, 0));
    for (let k = 1; k <= steps; k++) {
      const s = (e.span * k) / steps;
      const o = l + laneShift(e, s);
      const bx = e.x0 + e.dx * s + e.rx * o, bz = e.z0 + e.dz * s + e.rz * o;
      segs.push({ ax, az, bx, bz });
      ax = bx; az = bz;
    }
    return segs;
  }));
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
    // The 1980s plane rows stand on the surveyed 27 Grudnia promenade, a raised strip outside the block raster. Their
    // `promenade` flag marks the one allowed off-block street row; every other street tree still needs its whole trunk
    // on one curb island.
    const b = config.blockAt(t.x, t.z);
    if (!t.promenade && (!b || [-r, r].some((dx) => [-r, r].some((dz) => config.blockAt(t.x + dx, t.z + dz) !== b)))) {
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
  const extraCounts = helpers || (tram && tramLayout) ? {} : null;
  if (helpers) {
    Object.assign(extraCounts, { rail: 0, poleProc: 0, poleOverlap: 0, poleOsmLt22: 0, poleOsmLt05: 0, wall: 0, plazaProc: 0, water: 0 });
    for (const t of trees) {
      const isOsm = t.source === 'osm' || t.source === 'site';
      if (helpers.clearOfRails && !helpers.clearOfRails(t.x, t.z, 0.4 * t.scale)) extraCounts.rail++;
      if (config.isWater && config.isWater(t.x, t.z)) extraCounts.water++;
      if (helpers.isClearOfPoles) {
        if (!isOsm && !helpers.isClearOfPoles(t.x, t.z, 2.2)) extraCounts.poleProc++;
        if (isOsm && !helpers.isClearOfPoles(t.x, t.z, 2.2)) extraCounts.poleOsmLt22++;
        if (isOsm && !helpers.isClearOfPoles(t.x, t.z, 0.5)) extraCounts.poleOsmLt05++;
      }
      if (helpers.clearOfOsmPoleOverlap && !helpers.clearOfOsmPoleOverlap(t.x, t.z, t.scale)) extraCounts.poleOverlap++;
      if (helpers.inPlaza && !isOsm && helpers.inPlaza(t.x, t.z, 1.5)) extraCounts.plazaProc++;
      if (helpers.isClearOfWalls) {
        const squeeze = isOsm ? 0.3 : (t.sx || t.sz || 0.82);
        const tier = isOsm ? 1 : (t.tier || 1);
        if (!helpers.isClearOfWalls(t.x, t.z, t.scale, t.species, squeeze, t.y, tier)) extraCounts.wall++;
      }
    }
  }
  if (tram && tramLayout && extraCounts) {
    const platformRects = [], shelterRects = [], tramPoleCells = new Map();
    const trackByRail = new Map(tramLayout.tracks.map((tr) => [tr.railIndex, tr]));
    for (const st of tramLayout.stops) {
      if (st.platform) {
        const tr = trackByRail.get(st.railIndex);
        for (const rect of tram.platformPieceRects(tr, st.platform)) platformRects.push(rect);
      }
      if (st.shelter) shelterRects.push(tram.shelterRect(st.shelter));
    }
    for (const p of tramLayout.poles) {
      const k = `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`;
      if (!tramPoleCells.has(k)) tramPoleCells.set(k, []);
      tramPoleCells.get(k).push(p);
    }
    extraCounts.tramPlatform = 0;
    extraCounts.tramShelter = 0;
    extraCounts.tramPoleOverlap = 0;
    extraCounts.tramPoleLt22 = 0;
    extraCounts.tramPoleLt05 = 0;
    for (const t of trees) {
      const r = 0.28 * t.scale;
      for (const p of platformRects) {
        const dx = t.x - p.cx, dz = t.z - p.cz;
        if (dx * dx + dz * dz > 100) continue;
        if (Math.abs(dx * p.dx + dz * p.dz) < p.hx + r && Math.abs(-dx * p.dz + dz * p.dx) < p.hz + r) {
          extraCounts.tramPlatform++; break;
        }
      }
      for (const sh of shelterRects) {
        const dx = t.x - sh.cx, dz = t.z - sh.cz;
        if (dx * dx + dz * dz > 25) continue;
        if (Math.abs(dx * sh.dx + dz * sh.dz) < sh.hx + r && Math.abs(-dx * sh.dz + dz * sh.dx) < sh.hz + r) {
          extraCounts.tramShelter++; break;
        }
      }
      const ix = Math.floor(t.x / 8), iz = Math.floor(t.z / 8);
      let bestPole = Infinity;
      for (let x = ix - 1; x <= ix + 1; x++) for (let z = iz - 1; z <= iz + 1; z++) {
        for (const p of tramPoleCells.get(`${x},${z}`) || []) bestPole = Math.min(bestPole, Math.hypot(t.x - p.x, t.z - p.z));
      }
      if (bestPole < r + 0.16 + 0.15) extraCounts.tramPoleOverlap++;
      if (bestPole < 2.2) extraCounts.tramPoleLt22++;
      if (bestPole < 0.5) extraCounts.tramPoleLt05++;
    }
  }
  const counts = Object.fromEntries(Object.entries(violations).map(([k, v]) => [k, v.length]));
  const treeSet = new Set(trees);
  const parkTrees = sites.filter((t) => !treeSet.has(t));
  const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return { parkHash: digest(parkTrees), footprintHash: digest([grid.footprints, details.footprints]), counts,
    ...(extraCounts ? { extraCounts } : {}),
    streetTrees: trees.length, totalTrees: sites.length, minLane, minTreeDistance, minMovedTreeDistance, buildMs,
    networkNodes: network.nodes.length, networkEdges: network.edges.length,
    crosswalks: routes.crosswalks.length, placement: details.treePlacement, trees, parkTrees, violations };
}

function auditOsmWindows({ sites, trees, config, helpers }) {
  const windows = [
    { name: 'Stare Miasto (Stary Rynek)', x0: -500, x1: 500, z0: -500, z1: 500 },
    { name: 'Around Park Cytadela', x0: -800, x1: 900, z0: -2100, z1: -800 }
  ];
  const cell = 16;
  const indexPts = (pts) => {
    const map = new Map();
    for (const p of pts) {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return map;
  };
  const nearestIn = (grid, x, z, maxR = 32) => {
    const rad = Math.ceil(maxR / cell);
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    let best = Infinity, bestPt = null;
    for (let i = ix - rad; i <= ix + rad; i++) for (let j = iz - rad; j <= iz + rad; j++) {
      for (const p of grid.get(`${i},${j}`) || []) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < best) { best = d; bestPt = p; }
      }
    }
    return { dist: best, pt: bestPt };
  };
  const dropReason = (t) => {
    const { x, z } = t;
    if (helpers.nearPlanter(x, z)) return 'nearPlanter';
    const b = helpers.treeBlockAt(x, z);
    const promenade = !b && helpers.onPromenade(x, z);
    if (!b && !promenade) return 'noBlock';
    if (b && b.median) return 'median';
    if (b && b.underpass) return 'underpass';
    if (config.isWater(x, z)) return 'water';
    const plaza = b ? helpers.inPlaza(x, z, 1.0) : false;
    const street = promenade || (!(b.park > 0.6) && !plaza);
    let scale;
    if (t.height > 0) scale = Math.min(1.25, Math.max(0.55, t.height / 13));
    else {
      const r = ((Math.sin(x * 127.1 + 3.7 * 311.7 + z * 74.7) * 43758.5453) % 1 + 1) % 1;
      scale = street ? 0.6 + r * 0.25 : 0.9 + r * 0.4;
    }
    const y = promenade ? 0.238 : street ? 0.22 : (b.park > 0.6 ? 0.41 : (plaza ? 0.24 : 0.22));
    if (!helpers.clearOfRails(x, z, 0.4 * scale)) return 'rail';
    const wallSpecies = t.species >= 0 ? t.species : 2;
    if (!helpers.isClearOfWalls(x, z, scale, wallSpecies, 0.3, y, 1)) return 'wall';
    if (promenade && helpers.roadClearance(x, z) < 0.5 + 0.28 * scale) return 'promenadeRoad';
    if (promenade && !helpers.clearOfCrosswalks(x, z, 0.28 * scale * Math.SQRT2)) return 'landing';
    if (!promenade && !helpers.clearStreetTree(x, z, scale)) {
      const r = 0.28 * scale;
      if ([-r, r].some((ox) => [-r, r].some((oz) => helpers.treeBlockAt(x + ox, z + oz) !== b))) return 'islandCorner';
      if (!helpers.clearOfCrosswalks(x, z, r * Math.SQRT2)) return 'landing';
      return 'laneOrZebra';
    }
    return 'wall';
  };
  const osmGridAll = indexPts(config.OSM_TREES);
  const builtGridAll = indexPts(sites);
  const report = { source: 'js/geodata.js GEO.trees (from tools/data/poz_trees.json via tools/poz-trees.mjs)', windows: {} };
  for (const w of windows) {
    const inWin = (p) => p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1;
    const osmPts = config.OSM_TREES.filter(inWin);
    const builtAll = sites.filter(inWin);
    const builtStreet = trees.filter(inWin);
    let matched05 = 0, matched1 = 0, matched2 = 0, builtGt1m = 0, osmMovedGt1m = 0;
    const movedExamples = [];
    for (const t of builtStreet) {
      const { dist } = nearestIn(osmGridAll, t.x, t.z);
      if (dist <= 0.5) matched05++;
      if (dist <= 1.0) matched1++;
      if (dist <= 2.0) matched2++;
      if (dist > 1.0) {
        builtGt1m++;
        if (t.source === 'osm' || t.source === 'site') osmMovedGt1m++;
        else if (movedExamples.length < 3) {
          movedExamples.push({ kind: 'builtStreet>1m', x: +t.x.toFixed(2), z: +t.z.toFixed(2),
            nearestOsmM: Number.isFinite(dist) ? +dist.toFixed(2) : null,
            reason: 'procedural street row (>4 m from any OSM tree)' });
        }
      }
    }
    const dropReasons = {};
    const dropExamples = [];
    let osmNoBuilt = 0;
    for (const p of osmPts) {
      const { dist } = nearestIn(builtGridAll, p.x, p.z);
      if (dist > 0.5) {
        osmNoBuilt++;
        const reason = dropReason(p);
        dropReasons[reason] = (dropReasons[reason] || 0) + 1;
        if (dropExamples.length < 5) {
          dropExamples.push({ kind: 'osmDropped', x: +p.x.toFixed(2), z: +p.z.toFixed(2), reason });
        }
      }
    }
    report.windows[w.name] = {
      bounds: { x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 },
      osmCount: osmPts.length,
      builtAll: builtAll.length,
      builtStreet: builtStreet.length,
      builtOsmStreet: builtStreet.filter((t) => t.source === 'osm' || t.source === 'site').length,
      matchedWithin05m: matched05,
      matchedWithin1m: matched1,
      matchedWithin2m: matched2,
      osmNoBuilt,
      dropReasons,
      builtMovedGt1m: builtGt1m,
      osmMovedGt1m,
      examples: [...dropExamples, ...movedExamples]
    };
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { trees, parkTrees, violations, ...report } = await runAudit({
    full: process.argv.includes('--full'),
    osm: process.argv.includes('--osm'),
    reuseNetwork: !process.argv.includes('--rebuild-network')
  });
  console.log(JSON.stringify(report, null, 2));
}
